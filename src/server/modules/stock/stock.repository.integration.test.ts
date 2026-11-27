import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  lockStockBalance,
  onHandUnitCost,
  takeCoveredFromLots,
  takeFromLot,
  takeFromLots,
} from "@/server/modules/stock/stock.repository";
import { resetDatabase, testPrisma } from "@/server/testing/database";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

// Resolves once some transaction of this database is waiting for a lock another one holds.
async function someoneWaitsForALock() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [{ waiting }] = await testPrisma.$queryRaw<[{ waiting: number }]>`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;

    if (waiting > 0) return;

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Nobody ended up waiting for a lock.");
}

describe("taking from the lots of one product at the same time", () => {
  it("lets a write-off of one lot wait for a consumption already under way, instead of deadlocking with it", async () => {
    const product = await testPrisma.product.create({
      data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" },
    });
    await testPrisma.productStock.create({
      data: { productSku: product.sku, quantity: "10", averageCost: "4", lastEntryCost: "4" },
    });
    const lot = await testPrisma.stockLot.create({
      data: { productSku: product.sku, quantity: "10", initialQuantity: "10", unitCost: "4" },
    });

    let consumptionHoldsTheBalance = () => {};
    const balanceHeld = new Promise<void>((resolve) => {
      consumptionHoldsTheBalance = resolve;
    });

    // The consumption is caught between its two steps: it holds the balance and has yet to reach
    // the lots when the write-off arrives.
    const consumption = testPrisma.$transaction(async (tx) => {
      await lockStockBalance(tx, product.sku);
      consumptionHoldsTheBalance();
      await someoneWaitsForALock();

      return takeFromLots(tx, { productSku: product.sku, quantity: new Prisma.Decimal(3), today: "2026-01-01" });
    });
    const writeOff = balanceHeld.then(() =>
      testPrisma.$transaction((tx) => takeFromLot(tx, { lotId: lot.id, quantity: new Prisma.Decimal(2) })),
    );

    const [consumed, writtenOff] = await Promise.allSettled([consumption, writeOff]);

    expect(consumed).toMatchObject({ status: "fulfilled" });
    expect(writtenOff).toMatchObject({ status: "fulfilled" });
    expect((await testPrisma.stockLot.findUniqueOrThrow({ where: { id: lot.id } })).quantity.toString()).toBe("5");
    expect(
      (await testPrisma.productStock.findUniqueOrThrow({ where: { productSku: product.sku } })).quantity.toString(),
    ).toBe("5");
  });
});

describe("taking more than the lots of a product cover", () => {
  it("costs what is owed at the last entry cost when the product never had a lot", async () => {
    const product = await testPrisma.product.create({
      data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" },
    });
    // A balance that went negative before there were lots: nothing was left to turn into one.
    await testPrisma.productStock.create({
      data: { productSku: product.sku, quantity: "-2", averageCost: "4", lastEntryCost: "4.5" },
    });

    const taken = await testPrisma.$transaction((tx) =>
      takeFromLots(tx, { productSku: product.sku, quantity: new Prisma.Decimal(3), today: "2026-01-01" }),
    );

    expect(
      taken.map((take) => ({ ...take, quantity: take.quantity.toString(), unitCost: take.unitCost.toString() })),
    ).toEqual([{ lotId: null, quantity: "3", unitCost: "4.5", lotQuantity: null, packageContent: null }]);
    expect(
      (await testPrisma.productStock.findUniqueOrThrow({ where: { productSku: product.sku } })).quantity.toString(),
    ).toBe("-5");
  });
});

describe("taking a quantity that spans several lots", () => {
  it("takes from each lot it reaches, stamps them as changed and leaves the others alone", async () => {
    const product = await testPrisma.product.create({
      data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" },
    });
    await testPrisma.productStock.create({ data: { productSku: product.sku, quantity: "9", averageCost: "4" } });

    const longAgo = new Date("2020-01-01T00:00:00.000Z");
    const lotExpiring = (expiresAt: string) =>
      testPrisma.stockLot.create({
        data: {
          productSku: product.sku,
          quantity: "3",
          initialQuantity: "3",
          unitCost: "4",
          expiresAt: new Date(expiresAt),
          updatedAt: longAgo,
        },
      });
    const first = await lotExpiring("2099-01-01");
    const second = await lotExpiring("2099-02-01");
    const third = await lotExpiring("2099-03-01");

    await testPrisma.$transaction((tx) =>
      takeFromLots(tx, { productSku: product.sku, quantity: new Prisma.Decimal(4), today: "2026-01-01" }),
    );

    const after = async (id: string) => {
      const lot = await testPrisma.stockLot.findUniqueOrThrow({ where: { id } });

      return { quantity: lot.quantity.toString(), changed: lot.updatedAt > longAgo };
    };

    expect(await after(first.id)).toEqual({ quantity: "0", changed: true });
    expect(await after(second.id)).toEqual({ quantity: "2", changed: true });
    expect(await after(third.id)).toEqual({ quantity: "3", changed: false });
  });
});

const TODAY = "2026-06-01";

async function newProduct() {
  return testPrisma.product.create({ data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM" } });
}

async function newLot(productSku: string, quantity: string, unitCost: string, expiresAt?: string) {
  return testPrisma.stockLot.create({
    data: {
      productSku,
      quantity,
      initialQuantity: quantity,
      unitCost,
      expiresAt: expiresAt === undefined ? null : new Date(expiresAt),
    },
  });
}

describe("the cost of the lots on hand", () => {
  it("weighs each lot's cost by what is left of it", async () => {
    const product = await newProduct();
    await newLot(product.sku, "80", "10");
    await newLot(product.sku, "20", "6");

    expect((await onHandUnitCost(testPrisma, { productSku: product.sku, today: TODAY }))?.toString()).toBe("9.2");
  });

  it("leaves an expired lot out", async () => {
    const product = await newProduct();
    await newLot(product.sku, "80", "10");
    await newLot(product.sku, "20", "6");
    await newLot(product.sku, "50", "1", "2026-05-01");

    expect((await onHandUnitCost(testPrisma, { productSku: product.sku, today: TODAY }))?.toString()).toBe("9.2");
  });

  it("leaves a lot of unknown cost (zero) out of the basis", async () => {
    const product = await newProduct();
    await newLot(product.sku, "10", "5");
    await newLot(product.sku, "10", "0");

    expect((await onHandUnitCost(testPrisma, { productSku: product.sku, today: TODAY }))?.toString()).toBe("5");
  });

  it("is null when every lot on hand has an unknown cost", async () => {
    const product = await newProduct();
    await newLot(product.sku, "10", "0");
    await newLot(product.sku, "5", "0");

    expect(await onHandUnitCost(testPrisma, { productSku: product.sku, today: TODAY })).toBeNull();
  });

  it("is null when no lot is on hand", async () => {
    const product = await newProduct();

    expect(await onHandUnitCost(testPrisma, { productSku: product.sku, today: TODAY })).toBeNull();
  });

  it("ignores a lot that was emptied", async () => {
    const product = await newProduct();
    await newLot(product.sku, "0", "6");
    await newLot(product.sku, "100", "10");
    await newLot(product.sku, "100", "10");

    expect((await onHandUnitCost(testPrisma, { productSku: product.sku, today: TODAY }))?.toString()).toBe("10");
  });
});

describe("taking only what the lots cover", () => {
  const take = (productSku: string, quantity: number) =>
    testPrisma.$transaction((tx) =>
      takeCoveredFromLots(tx, { productSku, quantity: new Prisma.Decimal(quantity), today: TODAY }),
    );

  it("takes from the lot that expires first and then the next", async () => {
    const product = await newProduct();
    await testPrisma.productStock.create({ data: { productSku: product.sku, quantity: "70" } });
    const a = await newLot(product.sku, "20", "4", "2026-08-01");
    const b = await newLot(product.sku, "50", "5", "2026-09-01");

    const result = await take(product.sku, 30);

    expect(result).toMatchObject({
      takes: [
        { lotId: a.id, quantity: expect.objectContaining({}), unitCost: expect.objectContaining({}) },
        { lotId: b.id },
      ],
    });
    if (!("takes" in result)) throw new Error("expected takes");
    expect(result.takes.map((t) => [t.lotId, t.quantity.toString(), t.unitCost.toString()])).toEqual([
      [a.id, "20", "4"],
      [b.id, "10", "5"],
    ]);
    expect((await testPrisma.stockLot.findUniqueOrThrow({ where: { id: a.id } })).quantity.toString()).toBe("0");
    expect((await testPrisma.stockLot.findUniqueOrThrow({ where: { id: b.id } })).quantity.toString()).toBe("40");
    expect(
      (await testPrisma.productStock.findUniqueOrThrow({ where: { productSku: product.sku } })).quantity.toString(),
    ).toBe("40");
  });

  it("refuses a shortfall and changes nothing", async () => {
    const product = await newProduct();
    await testPrisma.productStock.create({ data: { productSku: product.sku, quantity: "70" } });
    const a = await newLot(product.sku, "20", "4");
    const b = await newLot(product.sku, "50", "5");

    expect(await take(product.sku, 80)).toEqual({ failure: "insufficient" });

    expect((await testPrisma.stockLot.findUniqueOrThrow({ where: { id: a.id } })).quantity.toString()).toBe("20");
    expect((await testPrisma.stockLot.findUniqueOrThrow({ where: { id: b.id } })).quantity.toString()).toBe("50");
    expect(
      (await testPrisma.productStock.findUniqueOrThrow({ where: { productSku: product.sku } })).quantity.toString(),
    ).toBe("70");
  });

  it("takes what the lots hold even when the balance is owed", async () => {
    const product = await newProduct();
    await testPrisma.productStock.create({ data: { productSku: product.sku, quantity: "2" } });
    await newLot(product.sku, "5", "4");

    const result = await take(product.sku, 5);

    expect("takes" in result).toBe(true);
  });
});
