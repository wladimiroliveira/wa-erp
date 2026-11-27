import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@prisma/client";
import * as outflows from "@/app/v1/stock-outflows/route";
import * as summary from "@/app/v1/stock-outflows/summary/route";
import { localToday } from "@/server/lib/dates";
import { rateLimiter } from "@/server/http/rate-limit";
import { authenticateAs } from "@/server/testing/authenticate";
import { inject } from "@/server/testing/inject";
import { resetDatabase, testPrisma } from "@/server/testing/database";

beforeEach(() => {
  rateLimiter.reset();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

type Headers = { authorization: string } | undefined;

const MISSING_ID = "0199a1f0-0000-7000-8000-0000000000ff";

const post = (headers: Headers, payload: Record<string, unknown>) =>
  inject(outflows, { method: "POST", url: "/v1/stock-outflows", headers, payload });

const canSell = () => authenticateAs([Permission.SALES_CREATE]);

async function product({
  description = "Bread",
  kind = "MANUFACTURED",
  isActive = true,
  price = "13.80" as string | null,
} = {}) {
  const created = await testPrisma.product.create({
    data: { description, kind: kind as "MANUFACTURED" | "GOODS", unit: "UNIT", isActive },
  });

  if (price !== null) {
    await testPrisma.productPrice.create({
      data: { productSku: created.sku, price, averageCost: "8", markupPercent: "50" },
    });
  }

  return created;
}

async function lot(productSku: string, quantity: string, unitCost: string, expiresAt: string | null = null) {
  return testPrisma.stockLot.create({
    data: {
      productSku,
      quantity,
      initialQuantity: quantity,
      unitCost,
      expiresAt: expiresAt === null ? null : new Date(expiresAt),
    },
  });
}

async function balance(productSku: string, quantity: string) {
  await testPrisma.productStock.create({ data: { productSku, quantity, averageCost: "8", lastEntryCost: "8" } });
}

const lotQuantity = async (id: string) =>
  (await testPrisma.stockLot.findUniqueOrThrow({ where: { id } })).quantity.toString();

describe("POST /v1/stock-outflows", () => {
  it("records a sale across two lots at each lot's cost", async () => {
    const { headers, userId } = await canSell();
    const bread = await product();
    const first = await lot(bread.sku, "2", "10", "2099-01-01");
    const second = await lot(bread.sku, "5", "6", "2099-06-01");
    await balance(bread.sku, "7");

    const response = await post(headers, { kind: "SALE", productSku: bread.sku, quantity: "3", unitPrice: "12.00" });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      kind: "SALE",
      product: { sku: bread.sku, description: "Bread", unit: "UNIT" },
      quantity: "3",
      listPrice: "13.80",
      unitPrice: "12.00",
      cost: "26.00",
      revenue: "36.00",
      profit: "10.00",
      note: null,
      createdBy: { id: userId, name: "Test Person" },
    });

    const movements = await testPrisma.stockMovement.findMany({
      where: { outflowId: body.id },
      orderBy: { unitCost: "desc" },
    });
    expect(movements.map((m) => [m.type, m.lotId, m.quantity.toString(), m.unitCost?.toString()])).toEqual([
      ["SALE", first.id, "2", "10"],
      ["SALE", second.id, "1", "6"],
    ]);
    expect(await lotQuantity(first.id)).toBe("0");
    expect(await lotQuantity(second.id)).toBe("4");
  });

  it("records a donation of a goods product without prices", async () => {
    const { headers } = await canSell();
    const rice = await product({ kind: "GOODS", price: null });
    await lot(rice.sku, "5", "3");
    await balance(rice.sku, "5");

    const response = await post(headers, { kind: "DONATION", productSku: rice.sku, quantity: "2", note: " Charity " });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      kind: "DONATION",
      listPrice: null,
      unitPrice: null,
      cost: "6.00",
      revenue: null,
      profit: null,
      note: "Charity",
    });
  });

  it("refuses to sell a goods product", async () => {
    const { headers } = await canSell();
    const rice = await product({ kind: "GOODS" });
    const stock = await lot(rice.sku, "5", "3");
    await balance(rice.sku, "5");

    const response = await post(headers, { kind: "SALE", productSku: rice.sku, quantity: "1", unitPrice: "5.00" });

    expect(response.statusCode).toBe(409);
    expect(await lotQuantity(stock.id)).toBe("5");
  });

  it("refuses a sale of a product without a price and leaves the lots alone", async () => {
    const { headers } = await canSell();
    const bread = await product({ price: null });
    const stock = await lot(bread.sku, "5", "3");
    await balance(bread.sku, "5");

    const response = await post(headers, { kind: "SALE", productSku: bread.sku, quantity: "1", unitPrice: "5.00" });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The product has no price.");
    expect(await lotQuantity(stock.id)).toBe("5");
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect(
      (await testPrisma.productStock.findUniqueOrThrow({ where: { productSku: bread.sku } })).quantity.toString(),
    ).toBe("5");
  });

  it("refuses when the stock does not cover the quantity", async () => {
    const { headers } = await canSell();
    const bread = await product();
    const stock = await lot(bread.sku, "2", "3");
    await balance(bread.sku, "2");

    const response = await post(headers, { kind: "DONATION", productSku: bread.sku, quantity: "3" });

    expect(response.statusCode).toBe(409);
    expect(await lotQuantity(stock.id)).toBe("2");
  });

  it("does not use expired lots", async () => {
    const { headers } = await canSell();
    const bread = await product();
    const expired = await lot(bread.sku, "5", "3", "2000-01-01");
    await balance(bread.sku, "5");

    const response = await post(headers, { kind: "DONATION", productSku: bread.sku, quantity: "1" });

    expect(response.statusCode).toBe(409);
    expect(await lotQuantity(expired.id)).toBe("5");
  });

  it("refuses an inactive product", async () => {
    const { headers } = await canSell();
    const bread = await product({ isActive: false });
    await lot(bread.sku, "5", "3");
    await balance(bread.sku, "5");

    const response = await post(headers, { kind: "DONATION", productSku: bread.sku, quantity: "1" });

    expect(response.statusCode).toBe(409);
  });

  it("answers 404 for an unknown product", async () => {
    const { headers } = await canSell();

    const response = await post(headers, { kind: "DONATION", productSku: MISSING_ID, quantity: "1" });

    expect(response.statusCode).toBe(404);
  });

  it("answers 403 without SALES_CREATE", async () => {
    const { headers } = await authenticateAs([Permission.LOSSES_CREATE]);

    const response = await post(headers, { kind: "DONATION", productSku: MISSING_ID, quantity: "1" });

    expect(response.statusCode).toBe(403);
  });

  it("lets only one of two simultaneous requests take the last units", async () => {
    const { headers } = await canSell();
    const bread = await product();
    const stock = await lot(bread.sku, "5", "3");
    await balance(bread.sku, "5");

    const responses = await Promise.all([
      post(headers, { kind: "SALE", productSku: bread.sku, quantity: "5", unitPrice: "12.00" }),
      post(headers, { kind: "SALE", productSku: bread.sku, quantity: "5", unitPrice: "12.00" }),
    ]);

    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await lotQuantity(stock.id)).toBe("0");
  });
});

describe("GET /v1/stock-outflows and /summary", () => {
  const list = (headers: Headers, query: string) =>
    inject(outflows, { method: "GET", url: `/v1/stock-outflows?${query}`, headers });
  const sum = (headers: Headers, query: string) =>
    inject(summary, { method: "GET", url: `/v1/stock-outflows/summary?${query}`, headers });

  async function seed() {
    const { headers } = await authenticateAs([Permission.SALES_CREATE, Permission.SALES_READ]);
    const bread = await product();
    const cake = await product({ description: "Cake" });
    await lot(bread.sku, "20", "6");
    await lot(cake.sku, "20", "5");
    await balance(bread.sku, "20");
    await balance(cake.sku, "20");

    await post(headers, { kind: "SALE", productSku: bread.sku, quantity: "2", unitPrice: "12.00" });
    await post(headers, { kind: "SALE", productSku: cake.sku, quantity: "1", unitPrice: "10.00" });
    await post(headers, { kind: "DONATION", productSku: bread.sku, quantity: "1" });
    const old = (
      await post(headers, { kind: "SALE", productSku: bread.sku, quantity: "1", unitPrice: "99.00" })
    ).json();
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12);
    await testPrisma.stockOutflow.update({ where: { id: old.id }, data: { createdAt: lastMonth } });

    return { headers, bread, cake, today: localToday(), monthAgo: lastMonth.toLocaleDateString("sv") };
  }

  it("sums this period, counting what was recorded today", async () => {
    const { headers, today } = await seed();

    const response = await sum(headers, `from=${today}&to=${today}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      revenue: "34.00",
      saleCost: "17.00",
      profit: "17.00",
      donated: "6.00",
      result: "11.00",
      saleCount: 2,
      donationCount: 1,
    });
  });

  it("includes the older outflow when the period reaches back", async () => {
    const { headers, today, monthAgo } = await seed();

    const response = await sum(headers, `from=${monthAgo}&to=${today}`);

    expect(response.json()).toMatchObject({ saleCount: 3, revenue: "133.00" });
  });

  it("narrows the list and the summary by product", async () => {
    const { headers, today, cake } = await seed();

    const page = await list(headers, `from=${today}&to=${today}&productSku=${cake.sku}`);
    const total = await sum(headers, `from=${today}&to=${today}&productSku=${cake.sku}`);

    expect(page.json().items).toHaveLength(1);
    expect(page.json().items[0]).toMatchObject({ kind: "SALE", quantity: "1", cost: "5.00", revenue: "10.00" });
    expect(total.json()).toMatchObject({ revenue: "10.00", saleCount: 1, donationCount: 0 });
  });

  it("pages the list newest first", async () => {
    const { headers, today } = await seed();

    const first = (await list(headers, `from=${today}&to=${today}&limit=1`)).json();
    const second = (await list(headers, `from=${today}&to=${today}&limit=1&cursor=${first.nextCursor}`)).json();

    expect(first.items).toHaveLength(1);
    expect(first.items[0].kind).toBe("DONATION");
    expect(second.items[0].kind).toBe("SALE");
    expect(second.items[0].id).not.toBe(first.items[0].id);
  });

  it("answers 400 when the period ends before it starts", async () => {
    const { headers } = await authenticateAs([Permission.SALES_READ]);

    expect((await list(headers, "from=2026-11-10&to=2026-11-01")).statusCode).toBe(400);
    expect((await sum(headers, "from=2026-11-10&to=2026-11-01")).statusCode).toBe(400);
  });

  it("answers 403 without SALES_READ", async () => {
    const { headers } = await authenticateAs([Permission.SALES_CREATE]);

    expect((await list(headers, "from=2026-11-01&to=2026-11-30")).statusCode).toBe(403);
    expect((await sum(headers, "from=2026-11-01&to=2026-11-30")).statusCode).toBe(403);
  });
});
