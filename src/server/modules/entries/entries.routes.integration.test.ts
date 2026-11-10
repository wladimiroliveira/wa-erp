import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@prisma/client";
import * as entries from "@/app/v1/entries/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { authenticateAs } from "@/server/testing/authenticate";
import { inject } from "@/server/testing/inject";
import { resetDatabase, testPrisma } from "@/server/testing/database";

// authenticateAs signs in with the same username in every case, and the login rate limiter
// keeps its counters in the process.
beforeEach(() => {
  rateLimiter.reset();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createProduct = (overrides: { isActive?: boolean } = {}) =>
  testPrisma.product.create({ data: { description: "Wheat flour", kind: "GOODS", unit: "KILOGRAM", ...overrides } });

// Every entry says whether the lot expires; the tests that are not about it say it does not.
const postEntry = (headers: { authorization: string } | undefined, payload: Record<string, unknown>) =>
  inject(entries, { method: "POST", url: "/v1/entries", headers, payload: { expiresAt: null, ...payload } });

const lotsOf = (productSku: string) => testPrisma.stockLot.findMany({ where: { productSku } });

const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const stockOf = (productSku: string) => testPrisma.productStock.findUnique({ where: { productSku } });

describe("POST /v1/entries", () => {
  it("records the movement and opens the stock on a product's first entry", async () => {
    const { headers, userId } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, quantity: "10", unitCost: "4.5" });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      type: "ENTRY",
      quantity: "10",
      unitCost: "4.5",
      product: { sku: product.sku, description: "Wheat flour", unit: "KILOGRAM" },
      stock: { quantity: "10", lastEntryCost: "4.5", averageCost: "4.5" },
    });

    const movements = await testPrisma.stockMovement.findMany();

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ id: response.json().id, productSku: product.sku, createdById: userId });
    expect((await stockOf(product.sku))?.quantity.toString()).toBe("10");
  });

  it("adds to the balance and weights the average cost on the next entry", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    await postEntry(headers, { productSku: product.sku, quantity: "10", unitCost: "4" });
    const response = await postEntry(headers, { productSku: product.sku, quantity: "30", unitCost: "6" });

    expect(response.json().stock).toEqual({ quantity: "40", lastEntryCost: "6", averageCost: "5.5" });
    expect(await testPrisma.stockMovement.count()).toBe(2);
  });

  it("restarts the average cost from the entry when the previous balance is not positive", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();
    await testPrisma.productStock.create({
      data: { productSku: product.sku, quantity: "-5", lastEntryCost: "4", averageCost: "4" },
    });

    const response = await postEntry(headers, {
      productSku: product.sku,
      quantity: "10",
      unitCost: "6",
      deficit: "DISCOUNT",
    });

    expect(response.json().stock).toEqual({ quantity: "5", lastEntryCost: "6", averageCost: "6" });
  });

  it("leaves the minimum quantity of the stock untouched", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();
    await testPrisma.productStock.create({ data: { productSku: product.sku, minimumQuantity: "20" } });

    await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1" });

    expect((await stockOf(product.sku))?.minimumQuantity?.toString()).toBe("20");
  });

  it("loses no entry when several arrive at once", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => postEntry(headers, { productSku: product.sku, quantity: "2.5", unitCost: "3" })),
    );

    expect(responses.map((response) => response.statusCode)).toEqual(Array(8).fill(201));
    expect((await stockOf(product.sku))?.quantity.toString()).toBe("20");
    expect((await stockOf(product.sku))?.averageCost?.toString()).toBe("3");
    expect(await testPrisma.stockMovement.count()).toBe(8);
  });

  it("answers 404 for a product that does not exist, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);

    const response = await postEntry(headers, {
      productSku: "0199a1f0-0000-7000-8000-0000000000ff",
      quantity: "1",
      unitCost: "1",
    });

    expect(response.statusCode).toBe(404);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("answers 409 for an inactive product, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct({ isActive: false });

    const response = await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1" });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect(await stockOf(product.sku)).toBeNull();
  });

  it.each([
    ["a zero quantity", { quantity: "0", unitCost: "1" }],
    ["a negative quantity", { quantity: "-1", unitCost: "1" }],
    ["a quantity with more than six decimal places", { quantity: "1.0000001", unitCost: "1" }],
    ["a quantity that is not a decimal", { quantity: "ten", unitCost: "1" }],
    ["a negative unit cost", { quantity: "1", unitCost: "-0.01" }],
    ["a missing unit cost", { quantity: "1" }],
  ])("answers 400 for %s", async (_label, amounts) => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, ...amounts });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("accepts a zero unit cost, for goods received free of charge", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "0" });

    expect(response.statusCode).toBe(201);
  });

  it("answers 403 without ENTRIES_CREATE", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_READ]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1" });

    expect(response.statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postEntry(undefined, { productSku: "x", quantity: "1", unitCost: "1" })).statusCode).toBe(401);
  });

  it("opens a lot with the expiry date and the supplier, and ties the movement to it", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();
    const supplier = await testPrisma.supplier.create({ data: { name: "Santa Clara Mill" } });

    const response = await postEntry(headers, {
      productSku: product.sku,
      quantity: "10",
      unitCost: "4.5",
      expiresAt: "2099-12-31",
      supplierId: supplier.id,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().lot).toEqual({
      id: expect.any(String),
      expiresAt: "2099-12-31",
      supplier: { id: supplier.id, name: "Santa Clara Mill" },
      quantity: "10",
      packaging: null,
    });

    const [lot] = await lotsOf(product.sku);

    expect(lot).toMatchObject({ id: response.json().lot.id, supplierId: supplier.id });
    expect(lot!.initialQuantity.toString()).toBe("10");
    expect(lot!.quantity.toString()).toBe("10");
    expect(lot!.unitCost.toString()).toBe("4.5");
    expect(lot!.expiresAt?.toISOString()).toBe("2099-12-31T00:00:00.000Z");
    expect((await testPrisma.stockMovement.findFirst())?.lotId).toBe(lot!.id);
  });

  it("opens a lot of its own for each entry, even of the same product and expiry", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1", expiresAt: "2099-12-31" });
    await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1", expiresAt: "2099-12-31" });

    expect(await lotsOf(product.sku)).toHaveLength(2);
  });

  it("opens a lot that never expires and has no supplier when told so", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1" });

    expect(response.json().lot).toMatchObject({ expiresAt: null, supplier: null });
  });

  it("accepts a lot that expires today", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, {
      productSku: product.sku,
      quantity: "1",
      unitCost: "1",
      expiresAt: localDate(),
    });

    expect(response.statusCode).toBe(201);
  });

  it.each([
    ["a lot already expired", { expiresAt: "2020-01-01" }],
    ["an expiry that is not a date", { expiresAt: "31/12/2099" }],
    ["an expiry that is not a calendar day", { expiresAt: "2099-02-30" }],
    ["an unknown way of settling a negative balance", { deficit: "IGNORE" }],
    ["a supplier that is not an id", { supplierId: "mill" }],
  ])("answers 400 for %s", async (_label, overrides) => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, { productSku: product.sku, quantity: "1", unitCost: "1", ...overrides });

    expect(response.statusCode).toBe(400);
    expect(await lotsOf(product.sku)).toHaveLength(0);
  });

  it("answers 400 when the entry does not say whether the lot expires", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await inject(entries, {
      method: "POST",
      url: "/v1/entries",
      headers,
      payload: { productSku: product.sku, quantity: "1", unitCost: "1" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("answers 404 for a supplier that does not exist, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, {
      productSku: product.sku,
      quantity: "1",
      unitCost: "1",
      supplierId: "0199a1f0-0000-7000-8000-0000000000ff",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: "Supplier not found." });
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  describe("on a product whose balance is negative", () => {
    const owing = async (deficit: string) => {
      const product = await createProduct();
      await testPrisma.productStock.create({
        data: { productSku: product.sku, quantity: `-${deficit}`, lastEntryCost: "4", averageCost: "4" },
      });

      return product;
    };

    it("answers 409 with what is owed until the entry says how to settle it, and writes nothing", async () => {
      const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
      const product = await owing("3.5");

      const response = await postEntry(headers, { productSku: product.sku, quantity: "10", unitCost: "6" });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The product has a negative balance to settle.", deficit: "3.5" });
      expect(await testPrisma.stockMovement.count()).toBe(0);
      expect(await lotsOf(product.sku)).toHaveLength(0);
      expect((await stockOf(product.sku))?.quantity.toString()).toBe("-3.5");
    });

    it("brings the balance to zero first when told to, so the whole entry is in stock", async () => {
      const { headers, userId } = await authenticateAs([Permission.ENTRIES_CREATE]);
      const product = await owing("3.5");

      const response = await postEntry(headers, {
        productSku: product.sku,
        quantity: "10",
        unitCost: "6",
        deficit: "ZERO",
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().stock.quantity).toBe("10");
      expect(response.json().lot.quantity).toBe("10");

      const adjustment = await testPrisma.stockMovement.findFirst({ where: { type: "BALANCE_ADJUSTMENT" } });

      expect(adjustment).toMatchObject({ productSku: product.sku, createdById: userId, lotId: null });
      expect(adjustment?.quantity.toString()).toBe("3.5");
    });

    it("takes what is owed out of the new lot when told to", async () => {
      const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
      const product = await owing("3.5");

      const response = await postEntry(headers, {
        productSku: product.sku,
        quantity: "10",
        unitCost: "6",
        deficit: "DISCOUNT",
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().stock.quantity).toBe("6.5");
      expect(response.json().lot.quantity).toBe("6.5");

      const [lot] = await lotsOf(product.sku);

      expect(lot!.initialQuantity.toString()).toBe("10");
      expect(lot!.quantity.toString()).toBe("6.5");
      expect(await testPrisma.stockMovement.count()).toBe(1);
    });

    it("leaves the new lot empty and the rest still owed when the entry does not cover it", async () => {
      const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
      const product = await owing("3.5");

      const response = await postEntry(headers, {
        productSku: product.sku,
        quantity: "1",
        unitCost: "6",
        deficit: "DISCOUNT",
      });

      expect(response.json().stock.quantity).toBe("-2.5");
      expect(response.json().lot.quantity).toBe("0");
    });
  });

  describe("on a product that owes more than its balance shows, because it still holds an expired lot", () => {
    // 5 kg sit in an expired lot nothing may take from, and 2 kg more than the other lots held
    // were used: the balance reads 3, and 2 are owed.
    const owingBehindAnExpiredLot = async () => {
      const product = await createProduct();
      await testPrisma.productStock.create({
        data: { productSku: product.sku, quantity: "3", lastEntryCost: "4", averageCost: "4" },
      });
      await testPrisma.stockLot.create({
        data: {
          productSku: product.sku,
          quantity: "5",
          initialQuantity: "5",
          unitCost: "4",
          expiresAt: new Date("2020-01-01"),
        },
      });

      return product;
    };

    it("answers 409 with what is owed", async () => {
      const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
      const product = await owingBehindAnExpiredLot();

      const response = await postEntry(headers, { productSku: product.sku, quantity: "10", unitCost: "6" });

      expect(response.statusCode).toBe(409);
      expect(response.json().deficit).toBe("2");
    });

    it("brings the balance up to what the lots hold when told to", async () => {
      const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
      const product = await owingBehindAnExpiredLot();

      const response = await postEntry(headers, {
        productSku: product.sku,
        quantity: "10",
        unitCost: "6",
        deficit: "ZERO",
      });

      expect(response.json().stock.quantity).toBe("15");
      expect(response.json().lot.quantity).toBe("10");
    });

    it("takes what is owed out of the new lot when told to", async () => {
      const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
      const product = await owingBehindAnExpiredLot();

      const response = await postEntry(headers, {
        productSku: product.sku,
        quantity: "10",
        unitCost: "6",
        deficit: "DISCOUNT",
      });

      expect(response.json().stock.quantity).toBe("13");
      expect(response.json().lot.quantity).toBe("8");
    });
  });

  it("ignores the way of settling a negative balance when there is none", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const product = await createProduct();

    const response = await postEntry(headers, {
      productSku: product.sku,
      quantity: "10",
      unitCost: "6",
      deficit: "ZERO",
    });

    expect(response.json().lot.quantity).toBe("10");
    expect(await testPrisma.stockMovement.count()).toBe(1);
  });
});

describe("POST /v1/entries in packagings", () => {
  const createPackaged = async (packaging: { content: string; isActive?: boolean } = { content: "0.38" }) => {
    const product = await createProduct();
    const bag = await testPrisma.productPackaging.create({
      data: { productSku: product.sku, brand: "MOÇA", ...packaging },
    });

    return { product, bag };
  };

  it("records the packagings in the product's unit and keeps them on the lot", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const { product, bag } = await createPackaged();

    const response = await postEntry(headers, {
      productSku: product.sku,
      packagingId: bag.id,
      packageCount: 10,
      packagePrice: "4.50",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      quantity: "3.8",
      unitCost: "11.842105",
      lot: { quantity: "3.8", packaging: { id: bag.id, brand: "MOÇA", content: "0.38", count: 10, price: "4.5" } },
    });
    const [lot] = await lotsOf(product.sku);
    expect(lot).toMatchObject({ packagingId: bag.id, packageCount: 10 });
    expect(lot!.packagePrice?.toString()).toBe("4.5");
    expect([lot!.quantity, lot!.unitCost].map(String)).toEqual(["3.8", "11.842105"]);
  });

  it.each([
    [
      "a quantity the stock cannot hold",
      { content: "100000000" },
      { packageCount: 99999, packagePrice: "1" },
      "The quantity does not fit the stock.",
    ],
    [
      "a cost per unit the stock cannot hold",
      { content: "0.000001" },
      { packageCount: 1, packagePrice: "999999999999.99" },
      "The cost does not fit the stock.",
    ],
  ])("answers 400 for %s, and writes nothing", async (_, packaging, entry, message) => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const { product, bag } = await createPackaged(packaging);

    const response = await postEntry(headers, { productSku: product.sku, packagingId: bag.id, ...entry });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message });
    expect(await lotsOf(product.sku)).toEqual([]);
  });

  it("answers 404 for a packaging of another product, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const { product } = await createPackaged();
    const other = await testPrisma.product.create({
      data: { description: "Rye flour", kind: "GOODS", unit: "KILOGRAM" },
    });
    const otherBag = await testPrisma.productPackaging.create({
      data: { productSku: other.sku, brand: "MOÇA", content: "1" },
    });

    const response = await postEntry(headers, {
      productSku: product.sku,
      packagingId: otherBag.id,
      packageCount: 1,
      packagePrice: "1",
    });

    expect(response.statusCode).toBe(404);
    expect(await testPrisma.stockLot.count()).toBe(0);
  });

  it("answers 409 for an inactive packaging", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const { product, bag } = await createPackaged({ content: "1", isActive: false });

    const response = await postEntry(headers, {
      productSku: product.sku,
      packagingId: bag.id,
      packageCount: 1,
      packagePrice: "1",
    });

    expect(response.statusCode).toBe(409);
  });

  it.each([
    ["a body mixing both shapes", { quantity: "1", unitCost: "1", packageCount: 1, packagePrice: "1" }],
    ["a price with fractions of a cent", { packageCount: 1, packagePrice: "1.005" }],
    ["a fractional count", { packageCount: 1.5, packagePrice: "1" }],
  ])("answers 400 for %s", async (_label, body) => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);
    const { product, bag } = await createPackaged();

    const response = await postEntry(headers, { productSku: product.sku, packagingId: bag.id, ...body });

    expect(response.statusCode).toBe(400);
  });
});
