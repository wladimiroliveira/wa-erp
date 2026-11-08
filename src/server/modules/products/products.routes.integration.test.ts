import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@prisma/client";
import * as products from "@/app/v1/products/route";
import * as product from "@/app/v1/products/[sku]/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { authenticateAs } from "@/server/testing/authenticate";
import { resetDatabase, testPrisma } from "@/server/testing/database";
import { inject } from "@/server/testing/inject";

// authenticateAs signs in on every case, and the login rate limiter keeps its counters in the
// process: a budget shared between cases would make one test fail because of another.
beforeEach(() => {
  rateLimiter.reset();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const listProducts = (headers: { authorization: string } | undefined) =>
  inject(products, { method: "GET", url: "/v1/products", headers });

describe("GET /v1/products", () => {
  it("lists every product by description, with what a screen needs to pick one", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_READ]);
    const flour = await testPrisma.product.create({
      data: {
        description: "Wheat flour",
        kind: "GOODS",
        unit: "KILOGRAM",
        packagings: {
          create: [
            { content: "5", gtin: "7891000100103" },
            { content: "1", isActive: false },
          ],
        },
      },
      include: { packagings: { orderBy: { content: "asc" } } },
    });
    const [bag, sack] = flour.packagings;
    await testPrisma.productStock.create({ data: { productSku: flour.sku, quantity: 0, minimumQuantity: "12.5" } });
    const bread = await testPrisma.product.create({
      data: { description: "Bread", kind: "MANUFACTURED", unit: "UNIT", isActive: false },
    });

    const response = await listProducts(headers);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        sku: bread.sku,
        description: "Bread",
        kind: "MANUFACTURED",
        unit: "UNIT",
        isActive: false,
        minimumQuantity: null,
        packagings: [],
      },
      {
        sku: flour.sku,
        description: "Wheat flour",
        kind: "GOODS",
        unit: "KILOGRAM",
        isActive: true,
        minimumQuantity: "12.5",
        packagings: [
          { id: bag!.id, content: "1", gtin: null, isActive: false },
          { id: sack!.id, content: "5", gtin: "7891000100103", isActive: true },
        ],
      },
    ]);
  });

  it("answers an empty list when the catalog is empty", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_READ]);

    expect((await listProducts(headers)).json()).toEqual([]);
  });

  it("answers 403 without CATALOG_READ", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);

    expect((await listProducts(headers)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await listProducts(undefined)).statusCode).toBe(401);
  });
});

describe("GET /v1/products with filters", () => {
  let headers: { authorization: string };

  const searchProducts = (query: string) => inject(products, { method: "GET", url: `/v1/products?${query}`, headers });

  const descriptionsOf = async (query: string) =>
    (await searchProducts(query)).json().map(({ description }: { description: string }) => description);

  beforeEach(async () => {
    ({ headers } = await authenticateAs([Permission.CATALOG_READ]));
    await testPrisma.product.createMany({
      data: [
        { description: "Pão francês", kind: "MANUFACTURED", unit: "UNIT" },
        { description: "Farinha de trigo", kind: "GOODS", unit: "KILOGRAM" },
        { description: "Fermento biológico", kind: "GOODS", unit: "GRAM" },
        { description: "Leite integral", kind: "GOODS", unit: "LITER", isActive: false },
      ],
    });
    const skuOf = async (description: string) =>
      (await testPrisma.product.findUniqueOrThrow({ where: { description } })).sku;
    await testPrisma.productPackaging.createMany({
      data: [
        { productSku: await skuOf("Farinha de trigo"), content: "1", gtin: "7891000100103" },
        { productSku: await skuOf("Fermento biológico"), content: "500", gtin: "7896000200204" },
      ],
    });
  });

  it("finds by part of the description, whatever the case and the accents", async () => {
    expect(await descriptionsOf("q=PAO")).toEqual(["Pão francês"]);
    expect(await descriptionsOf("q=frances")).toEqual(["Pão francês"]);
    expect(await descriptionsOf("q=biol%C3%B3g")).toEqual(["Fermento biológico"]);
  });

  it("finds by part of the GTIN of one of its packagings", async () => {
    expect(await descriptionsOf("q=0001001")).toEqual(["Farinha de trigo"]);
  });

  it("reads the search as plain text, not as a pattern", async () => {
    expect(await descriptionsOf("q=%25")).toEqual([]);
    expect(await descriptionsOf("q=_")).toEqual([]);
  });

  it("ignores a blank search", async () => {
    expect(await descriptionsOf("q=%20%20")).toHaveLength(4);
  });

  it("filters by kind", async () => {
    expect(await descriptionsOf("kind=MANUFACTURED")).toEqual(["Pão francês"]);
  });

  it("filters by any of several units", async () => {
    expect(await descriptionsOf("unit=KILOGRAM&unit=GRAM")).toEqual(["Farinha de trigo", "Fermento biológico"]);
  });

  it("filters the active or the inactive products", async () => {
    expect(await descriptionsOf("status=INACTIVE")).toEqual(["Leite integral"]);
    expect(await descriptionsOf("status=ACTIVE")).toEqual(["Farinha de trigo", "Fermento biológico", "Pão francês"]);
  });

  it("answers only what every filter accepts", async () => {
    expect(await descriptionsOf("q=fer&kind=GOODS&unit=GRAM&status=ACTIVE")).toEqual(["Fermento biológico"]);
    expect(await descriptionsOf("q=leite&status=ACTIVE")).toEqual([]);
  });

  it("answers 400 for a kind, unit or status it does not know", async () => {
    expect((await searchProducts("kind=SERVICE")).statusCode).toBe(400);
    expect((await searchProducts("unit=TON")).statusCode).toBe(400);
    expect((await searchProducts("status=DELETED")).statusCode).toBe(400);
  });
});

const postProduct = (headers: { authorization: string } | undefined, payload: Record<string, unknown>) =>
  inject(products, { method: "POST", url: "/v1/products", headers, payload });

const FLOUR = { description: "WHEAT FLOUR", kind: "GOODS", unit: "KILOGRAM" };

describe("POST /v1/products", () => {
  it("registers an active product and answers it with its sku", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, {
      ...FLOUR,
      packagings: [
        { content: "5", unit: "KILOGRAM", gtin: "7891000100103" },
        { content: "380", unit: "GRAM" },
      ],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      ...FLOUR,
      sku: expect.any(String),
      isActive: true,
      minimumQuantity: null,
      packagings: [
        { id: expect.any(String), content: "0.38", gtin: null, isActive: true },
        { id: expect.any(String), content: "5", gtin: "7891000100103", isActive: true },
      ],
    });
    expect(await testPrisma.product.findUnique({ where: { sku: response.json().sku } })).toMatchObject(FLOUR);
  });

  it("registers the minimum quantity the stock should keep", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, { ...FLOUR, minimumQuantity: "25.5" });

    expect(response.statusCode).toBe(201);
    expect(response.json().minimumQuantity).toBe("25.5");
    const stock = await testPrisma.productStock.findUnique({ where: { productSku: response.json().sku } });
    expect(stock?.minimumQuantity?.toString()).toBe("25.5");
    expect(stock?.quantity.toString()).toBe("0");
  });

  it("registers a loose product, with no packaging", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, FLOUR);

    expect(response.statusCode).toBe(201);
    expect(response.json().packagings).toEqual([]);
  });

  it("trims the description and stores it in upper case", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, { ...FLOUR, description: "  açúcar refinado  " });

    expect(response.json().description).toBe("AÇÚCAR REFINADO");
  });

  it("answers 409 for a description already in the catalog, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);
    await postProduct(headers, FLOUR);

    const response = await postProduct(headers, { ...FLOUR, description: "wheat flour", unit: "GRAM" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A product with this description already exists." });
    expect(await testPrisma.product.count()).toBe(1);
  });

  it("answers 409 for a GTIN already on a packaging of another product, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);
    const bag = { content: "1", unit: "KILOGRAM", gtin: "7891000100103" };
    await postProduct(headers, { ...FLOUR, packagings: [bag] });

    const response = await postProduct(headers, { ...FLOUR, description: "RYE FLOUR", packagings: [bag] });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A packaging with this GTIN already exists." });
    expect(await testPrisma.product.count()).toBe(1);
  });

  it("answers 409 for two packagings of the same content, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, {
      ...FLOUR,
      packagings: [
        { content: "1", unit: "KILOGRAM" },
        { content: "1000", unit: "GRAM" },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The product already has a packaging with this content." });
    expect(await testPrisma.product.count()).toBe(0);
  });

  it.each([
    ["a blank description", { description: "   " }],
    ["a description longer than 120 characters", { description: "x".repeat(121) }],
    ["an unknown kind", { kind: "SERVICE" }],
    ["an unknown unit", { unit: "POUND" }],
    ["a missing unit", { unit: undefined }],
    ["a GTIN that is not made of digits", { packagings: [{ content: "1", unit: "KILOGRAM", gtin: "78910001001AB" }] }],
    ["a GTIN shorter than 8 digits", { packagings: [{ content: "1", unit: "KILOGRAM", gtin: "1234567" }] }],
    ["a GTIN longer than 14 digits", { packagings: [{ content: "1", unit: "KILOGRAM", gtin: "123456789012345" }] }],
    [
      "a GTIN whose check digit does not match",
      { packagings: [{ content: "1", unit: "KILOGRAM", gtin: "7891000100104" }] },
    ],
    ["a packaging in a unit of another dimension", { packagings: [{ content: "1", unit: "LITER" }] }],
    ["a packaging of zero content", { packagings: [{ content: "0", unit: "KILOGRAM" }] }],
    ["a minimum quantity of zero", { minimumQuantity: "0" }],
    ["a minimum quantity that is not a decimal string", { minimumQuantity: 10 }],
  ])("answers 400 for %s", async (_label, overrides) => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);

    const response = await postProduct(headers, { ...FLOUR, ...overrides });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.product.count()).toBe(0);
  });

  it("answers 403 without CATALOG_CREATE", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_READ]);

    expect((await postProduct(headers, FLOUR)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postProduct(undefined, FLOUR)).statusCode).toBe(401);
  });
});

const patchProduct = (headers: { authorization: string } | undefined, sku: string, payload: Record<string, unknown>) =>
  inject(product, { method: "PATCH", url: `/v1/products/${sku}`, params: { sku }, headers, payload });

const createFlour = (data: { isActive?: boolean } = {}) =>
  testPrisma.product.create({ data: { description: "WHEAT FLOUR", kind: "GOODS", unit: "KILOGRAM", ...data } });

const packagingsOf = (productSku: string) =>
  testPrisma.productPackaging.findMany({ where: { productSku }, orderBy: { content: "asc" } });

const UNKNOWN_SKU = "018f0000-0000-7000-8000-0000000000ff";

describe("PATCH /v1/products/:sku", () => {
  it("renames a product in upper case, keeping its kind, unit and packagings", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    await testPrisma.productPackaging.create({ data: { productSku: flour.sku, content: "1" } });

    const response = await patchProduct(headers, flour.sku, { description: "  Whole wheat flour " });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sku: flour.sku,
      description: "WHOLE WHEAT FLOUR",
      kind: "GOODS",
      unit: "KILOGRAM",
      isActive: true,
      minimumQuantity: null,
      packagings: [{ id: expect.any(String), content: "1", gtin: null, isActive: true }],
    });
  });

  it("makes the stored packagings the list sent: changes, registers and removes", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    const [bag, sack] = await testPrisma.productPackaging.createManyAndReturn({
      data: [
        { productSku: flour.sku, content: "1", gtin: "7891000100103" },
        { productSku: flour.sku, content: "5" },
      ],
    });

    const response = await patchProduct(headers, flour.sku, {
      packagings: [
        { id: bag!.id, content: "1000", unit: "GRAM", gtin: "78910003", isActive: false },
        { content: "380", unit: "GRAM" },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(
      (await packagingsOf(flour.sku)).map(({ id, content, gtin, isActive }) => [id, String(content), gtin, isActive]),
    ).toEqual([
      [expect.any(String), "0.38", null, true],
      [bag!.id, "1", "78910003", false],
    ]);
    expect(await testPrisma.productPackaging.findUnique({ where: { id: sack!.id } })).toBeNull();
  });

  it("answers 404 for a packaging that is not one of the product's, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    const rye = await testPrisma.product.create({
      data: { description: "RYE FLOUR", kind: "GOODS", unit: "KILOGRAM" },
    });
    const ryeBag = await testPrisma.productPackaging.create({ data: { productSku: rye.sku, content: "1" } });

    const response = await patchProduct(headers, flour.sku, {
      packagings: [{ id: ryeBag.id, content: "2", unit: "KILOGRAM" }],
    });

    expect(response.statusCode).toBe(404);
    expect(String((await testPrisma.productPackaging.findUniqueOrThrow({ where: { id: ryeBag.id } })).content)).toBe(
      "1",
    );
  });

  it("deactivates a product and activates it again", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();

    expect((await patchProduct(headers, flour.sku, { isActive: false })).json().isActive).toBe(false);
    expect((await patchProduct(headers, flour.sku, { isActive: true })).json().isActive).toBe(true);
  });

  it("sets the minimum quantity of a product that never moved, leaving its balance at zero", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();

    const response = await patchProduct(headers, flour.sku, { minimumQuantity: "8" });

    expect(response.json().minimumQuantity).toBe("8");
    const stock = await testPrisma.productStock.findUnique({ where: { productSku: flour.sku } });
    expect(stock?.quantity.toString()).toBe("0");
  });

  it("changes and clears the minimum quantity without touching the balance or its costs", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    await testPrisma.productStock.create({
      data: { productSku: flour.sku, quantity: "40", lastEntryCost: "3.5", averageCost: "3.2", minimumQuantity: "5" },
    });

    expect((await patchProduct(headers, flour.sku, { minimumQuantity: "10.25" })).json().minimumQuantity).toBe("10.25");
    expect((await patchProduct(headers, flour.sku, { minimumQuantity: null })).json().minimumQuantity).toBeNull();

    const stock = await testPrisma.productStock.findUnique({ where: { productSku: flour.sku } });
    expect(stock).toMatchObject({ minimumQuantity: null });
    expect([stock?.quantity, stock?.lastEntryCost, stock?.averageCost].map(String)).toEqual(["40", "3.5", "3.2"]);
  });

  it("does not change the kind or the unit", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();

    await patchProduct(headers, flour.sku, { description: "Rye flour", kind: "MANUFACTURED", unit: "GRAM" });

    expect(await testPrisma.product.findUnique({ where: { sku: flour.sku } })).toMatchObject({
      description: "RYE FLOUR",
      kind: "GOODS",
      unit: "KILOGRAM",
    });
  });

  it("keeps its own description and GTIN when they are sent unchanged", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    const bag = await testPrisma.productPackaging.create({
      data: { productSku: flour.sku, content: "1", gtin: "7891000100103" },
    });

    const response = await patchProduct(headers, flour.sku, {
      description: "Wheat flour",
      packagings: [{ id: bag.id, content: "1", unit: "KILOGRAM", gtin: "7891000100103" }],
    });

    expect(response.statusCode).toBe(200);
  });

  it("recognises the product itself when its sku is written in capitals", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();

    const response = await patchProduct(headers, flour.sku.toUpperCase(), { description: "Wheat flour" });

    expect(response.statusCode).toBe(200);
  });

  it("answers 409 for a description another product has, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    await testPrisma.product.create({ data: { description: "RYE FLOUR", kind: "GOODS", unit: "KILOGRAM" } });

    const response = await patchProduct(headers, flour.sku, { description: "Rye flour", minimumQuantity: "3" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A product with this description already exists." });
    expect((await testPrisma.product.findUnique({ where: { sku: flour.sku } }))?.description).toBe("WHEAT FLOUR");
    expect(await testPrisma.productStock.count()).toBe(0);
  });

  it("answers 409 for a GTIN on a packaging of another product", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    await testPrisma.product.create({
      data: {
        description: "RYE FLOUR",
        kind: "GOODS",
        unit: "KILOGRAM",
        packagings: { create: { content: "1", gtin: "7891000100103" } },
      },
    });

    const response = await patchProduct(headers, flour.sku, {
      packagings: [{ content: "1", unit: "KILOGRAM", gtin: "7891000100103" }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A packaging with this GTIN already exists." });
    expect(await packagingsOf(flour.sku)).toEqual([]);
  });

  it("answers 409, not 500, when two stored packagings swap contents in one save, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    const [bag, sack] = await testPrisma.productPackaging.createManyAndReturn({
      data: [
        { productSku: flour.sku, content: "1" },
        { productSku: flour.sku, content: "5" },
      ],
    });

    const response = await patchProduct(headers, flour.sku, {
      packagings: [
        { id: bag!.id, content: "5", unit: "KILOGRAM" },
        { id: sack!.id, content: "1", unit: "KILOGRAM" },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The product already has a packaging with this content." });
    expect((await packagingsOf(flour.sku)).map(({ id, content }) => [id, String(content)])).toEqual([
      [bag!.id, "1"],
      [sack!.id, "5"],
    ]);
  });

  it("moves contents and a GTIN between stored packagings when the result holds no duplicate", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    const [bag, sack] = await testPrisma.productPackaging.createManyAndReturn({
      data: [
        { productSku: flour.sku, content: "1" },
        { productSku: flour.sku, content: "5", gtin: "7891000100103" },
      ],
    });

    const response = await patchProduct(headers, flour.sku, {
      packagings: [
        { id: bag!.id, content: "5", unit: "KILOGRAM", gtin: "7891000100103" },
        { id: sack!.id, content: "10", unit: "KILOGRAM" },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect((await packagingsOf(flour.sku)).map(({ id, content, gtin }) => [id, String(content), gtin])).toEqual([
      [bag!.id, "5", "7891000100103"],
      [sack!.id, "10", null],
    ]);
  });

  it("answers 409 when the list leaves out a packaging stock lots came in, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    const [bag, sack] = await testPrisma.productPackaging.createManyAndReturn({
      data: [
        { productSku: flour.sku, content: "1" },
        { productSku: flour.sku, content: "5" },
      ],
    });
    await testPrisma.stockLot.create({
      data: {
        productSku: flour.sku,
        packagingId: sack!.id,
        packageCount: 1,
        initialQuantity: "5",
        quantity: "5",
        unitCost: "1",
      },
    });

    const response = await patchProduct(headers, flour.sku, {
      packagings: [{ id: bag!.id, content: "1", unit: "KILOGRAM" }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A packaging with stock lots cannot be removed." });
    expect(await packagingsOf(flour.sku)).toHaveLength(2);
  });

  it("answers 409 for a new content on a packaging stock lots came in, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();
    const bag = await testPrisma.productPackaging.create({ data: { productSku: flour.sku, content: "1" } });
    await testPrisma.stockLot.create({
      data: {
        productSku: flour.sku,
        packagingId: bag.id,
        packageCount: 2,
        initialQuantity: "2",
        quantity: "2",
        unitCost: "1",
      },
    });

    const response = await patchProduct(headers, flour.sku, {
      packagings: [{ id: bag.id, content: "2", unit: "KILOGRAM" }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "A packaging with stock lots cannot change its content." });
    expect(String((await testPrisma.productPackaging.findUniqueOrThrow({ where: { id: bag.id } })).content)).toBe("1");
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);

    const response = await patchProduct(headers, UNKNOWN_SKU, { isActive: false });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: "Product not found." });
  });

  it.each([
    ["an empty body", {}],
    ["only fields that cannot change", { kind: "MANUFACTURED", unit: "GRAM" }],
    ["a blank description", { description: "  " }],
    ["a GTIN that is not made of digits", { packagings: [{ content: "1", unit: "KILOGRAM", gtin: "78910001001AB" }] }],
    [
      "the same GTIN on two packagings",
      {
        packagings: [
          { content: "1", unit: "KILOGRAM", gtin: "7891000100103" },
          { content: "5", unit: "KILOGRAM", gtin: "7891000100103" },
        ],
      },
    ],
    ["a minimum quantity of zero", { minimumQuantity: "0" }],
    ["an active flag that is not a boolean", { isActive: "no" }],
  ])("answers 400 for %s", async (_label, payload) => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);
    const flour = await createFlour();

    expect((await patchProduct(headers, flour.sku, payload)).statusCode).toBe(400);
  });

  it("answers 400 for a sku that is not a uuid", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_UPDATE]);

    expect((await patchProduct(headers, "flour", { isActive: false })).statusCode).toBe(400);
  });

  it("answers 403 without CATALOG_UPDATE", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE, Permission.CATALOG_READ]);
    const flour = await createFlour();

    expect((await patchProduct(headers, flour.sku, { isActive: false })).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await patchProduct(undefined, UNKNOWN_SKU, { isActive: false })).statusCode).toBe(401);
  });
});
