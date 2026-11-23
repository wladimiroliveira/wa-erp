import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeasurementUnit, Permission, ProductKind } from "@prisma/client";
import * as productionCancel from "@/app/v1/productions/[id]/cancel/route";
import * as productionFinish from "@/app/v1/productions/[id]/finish/route";
import * as productionDamage from "@/app/v1/productions/[id]/items/[itemId]/damage/route";
import * as productionSubstitute from "@/app/v1/productions/[id]/items/[itemId]/substitute/route";
import * as productionReduce from "@/app/v1/productions/[id]/items/[itemId]/reduce/route";
import * as productionWeighings from "@/app/v1/productions/[id]/weighings/route";
import * as productionLeftovers from "@/app/v1/productions/[id]/leftovers/route";
import * as productionById from "@/app/v1/productions/[id]/route";
import * as productions from "@/app/v1/productions/route";
import * as preWeighingById from "@/app/v1/pre-weighings/[id]/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { authenticateAs } from "@/server/testing/authenticate";
import { resetDatabase, testPrisma } from "@/server/testing/database";
import { inject } from "@/server/testing/inject";

// authenticateAs signs in with the same username in every case, and the login rate limiter keeps
// its counters in the process.
beforeEach(() => {
  rateLimiter.reset();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const MISSING_ID = "0199a1f0-0000-7000-8000-0000000000ff";

type ProductOverrides = { kind?: ProductKind; unit?: MeasurementUnit; isActive?: boolean };
type Headers = { authorization: string } | undefined;

const createProduct = (description: string, overrides: ProductOverrides = {}) =>
  testPrisma.product.create({ data: { description, kind: "GOODS", unit: "KILOGRAM", ...overrides } });

// Bread dough: 25 kg out of 15 kg of flour and 9 L of water.
async function createDough() {
  const [dough, flour, water] = await Promise.all([
    createProduct("Bread dough", { kind: "MANUFACTURED" }),
    createProduct("Wheat flour"),
    createProduct("Water", { unit: "LITER" }),
  ]);

  await testPrisma.recipe.create({
    data: {
      productSku: dough.sku,
      yieldQuantity: "25",
      ingredients: {
        create: [
          { productSku: flour.sku, quantity: "15" },
          { productSku: water.sku, quantity: "9" },
        ],
      },
    },
  });

  return { dough, flour, water };
}

// Syrup: 10 L out of 4 kg of sugar.
async function createSyrup() {
  const [syrup, sugar] = await Promise.all([
    createProduct("Syrup", { kind: "MANUFACTURED", unit: "LITER" }),
    createProduct("Sugar"),
  ]);

  await testPrisma.recipe.create({
    data: {
      productSku: syrup.sku,
      yieldQuantity: "10",
      ingredients: { create: [{ productSku: sugar.sku, quantity: "4" }] },
    },
  });

  return { syrup, sugar };
}

// A pre-weighing for 50 kg of dough that weighed a little off the plan.
async function createDoughPreWeighing(userId: string) {
  const products = await createDough();
  const preWeighing = await testPrisma.preWeighing.create({
    data: {
      productSku: products.dough.sku,
      quantity: "50",
      createdById: userId,
      items: {
        create: [
          { productSku: products.flour.sku, plannedQuantity: "30", weighedQuantity: "30.25" },
          { productSku: products.water.sku, plannedQuantity: "18", weighedQuantity: "17.9" },
        ],
      },
    },
  });

  return { ...products, preWeighing };
}

// A balance is held in lots, so the stock is given one lot that never expires holding all of it.
async function stock(productSku: string, quantity: string, averageCost: string) {
  await testPrisma.productStock.create({ data: { productSku, quantity, averageCost, lastEntryCost: averageCost } });
  await lot(productSku, quantity, averageCost);
}

const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const lot = (productSku: string, quantity: string, unitCost: string, expiresAt: string | null = null) =>
  testPrisma.stockLot.create({
    data: {
      productSku,
      quantity,
      unitCost,
      initialQuantity: quantity,
      expiresAt: expiresAt === null ? null : new Date(expiresAt),
    },
  });

// A product held in several lots: the balance is their sum, and its average cost is not what the
// tests are about.
async function stockInLots(productSku: string, lots: [quantity: string, unitCost: string, expiresAt: string | null][]) {
  const total = lots.reduce((sum, [quantity]) => sum + Number(quantity), 0);
  await testPrisma.productStock.create({
    data: { productSku, quantity: String(total), averageCost: "1", lastEntryCost: "1" },
  });

  // One at a time: created together, which of them came in first would be left to chance.
  const created = [];

  for (const [quantity, unitCost, expiresAt] of lots) {
    created.push(await lot(productSku, quantity, unitCost, expiresAt));
  }

  return created;
}

const lotQuantity = async (id: string) =>
  (await testPrisma.stockLot.findUniqueOrThrow({ where: { id } })).quantity.toString();

async function stockOf(productSku: string) {
  const found = await testPrisma.productStock.findUnique({ where: { productSku } });

  return found === null
    ? null
    : { quantity: found.quantity.toString(), averageCost: found.averageCost?.toString() ?? null };
}

const postProduction = (headers: Headers, payload: Record<string, unknown>) =>
  inject(productions, { method: "POST", url: "/v1/productions", headers, payload });

const getProduction = (headers: Headers, id: string) =>
  inject(productionById, { method: "GET", url: `/v1/productions/${id}`, params: { id }, headers });

const postCancel = (headers: Headers, id: string) =>
  inject(productionCancel, { method: "POST", url: `/v1/productions/${id}/cancel`, params: { id }, headers });

const listProductions = (headers: Headers, query: Record<string, string> = {}) =>
  inject(productions, { method: "GET", url: "/v1/productions", headers, query });

// Every finished item says whether what it produced expires; the tests that are not about it say
// it does not.
const postFinish = (headers: Headers, id: string, payload: { items?: unknown[]; hasLeftoversInCost?: boolean }) =>
  inject(productionFinish, {
    method: "POST",
    url: `/v1/productions/${id}/finish`,
    params: { id },
    headers,
    payload: {
      ...payload,
      items: payload.items?.map((item) =>
        typeof item === "object" && item !== null ? { expiresAt: null, ...item } : item,
      ),
    },
  });

const postReduce = (headers: Headers, id: string, itemId: string, payload: Record<string, unknown>) =>
  inject(productionReduce, {
    method: "POST",
    url: `/v1/productions/${id}/items/${itemId}/reduce`,
    params: { id, itemId },
    headers,
    payload,
  });

const postDamage = (headers: Headers, id: string, itemId: string, payload: Record<string, unknown>) =>
  inject(productionDamage, {
    method: "POST",
    url: `/v1/productions/${id}/items/${itemId}/damage`,
    params: { id, itemId },
    headers,
    payload,
  });

const postWeighing = (headers: Headers, id: string, payload: Record<string, unknown>) =>
  inject(productionWeighings, {
    method: "POST",
    url: `/v1/productions/${id}/weighings`,
    params: { id },
    headers,
    payload,
  });

const postSubstitute = (headers: Headers, id: string, itemId: string) =>
  inject(productionSubstitute, {
    method: "POST",
    url: `/v1/productions/${id}/items/${itemId}/substitute`,
    params: { id, itemId },
    headers,
  });

const getSubstitution = (headers: Headers, id: string, itemId: string) =>
  inject(productionSubstitute, {
    method: "GET",
    url: `/v1/productions/${id}/items/${itemId}/substitute`,
    params: { id, itemId },
    headers,
  });

const getPreWeighing = (headers: Headers, id: string) =>
  inject(preWeighingById, { method: "GET", url: `/v1/pre-weighings/${id}`, params: { id }, headers });

const canRead = () => authenticateAs([Permission.PRODUCTION_READ]);
const canCreate = () => authenticateAs([Permission.PRODUCTION_CREATE]);
const canDoBoth = () => authenticateAs([Permission.PRODUCTION_READ, Permission.PRODUCTION_CREATE]);

describe("POST /v1/productions", () => {
  it("starts a free production, planning the inputs by the recipe and the expected yield", async () => {
    const { headers, userId } = await canCreate();
    const { dough, flour, water } = await createDough();

    const response = await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      status: "IN_PROGRESS",
      createdAt: expect.any(String),
      finishedAt: null,
      canceledAt: null,
      items: [
        {
          id: expect.any(String),
          status: "PENDING",
          finishedAt: null,
          hasLeftoversInCost: null,
          product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
          preWeighingId: null,
          expectedQuantity: "50",
          producedQuantity: null,
          unitCost: null,
          dependsOn: [],
          awaitsWeighing: false,
          damages: [],
          inputs: [
            {
              product: { sku: water.sku, description: "Water", unit: "LITER" },
              quantity: "18",
              unitCost: null,
              leftovers: [],
            },
            {
              product: { sku: flour.sku, description: "Wheat flour", unit: "KILOGRAM" },
              quantity: "30",
              unitCost: null,
              leftovers: [],
            },
          ],
        },
      ],
    });

    const stored = await testPrisma.production.findMany();

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: response.json().id, createdById: userId });
  });

  it("starts a guided production, taking what the pre-weighing weighed", async () => {
    const { headers, userId } = await canCreate();
    const { dough, flour, water, preWeighing } = await createDoughPreWeighing(userId);

    const response = await postProduction(headers, { preWeighingId: preWeighing.id });

    expect(response.statusCode).toBe(201);
    expect(response.json().items).toEqual([
      expect.objectContaining({
        product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
        preWeighingId: preWeighing.id,
        expectedQuantity: "50",
        inputs: [
          { product: expect.objectContaining({ sku: water.sku }), quantity: "17.9", unitCost: null, leftovers: [] },
          { product: expect.objectContaining({ sku: flour.sku }), quantity: "30.25", unitCost: null, leftovers: [] },
        ],
      }),
    ]);
  });

  it("guides an unweighed line by what was planned", async () => {
    const { headers, userId } = await canCreate();
    const { dough, flour, water } = await createDough();
    const preWeighing = await testPrisma.preWeighing.create({
      data: {
        productSku: dough.sku,
        quantity: "50",
        createdById: userId,
        items: {
          create: [
            { productSku: flour.sku, plannedQuantity: "30", weighedQuantity: null },
            { productSku: water.sku, plannedQuantity: "1", weighedQuantity: "17.9" },
          ],
        },
      },
    });

    const response = await postProduction(headers, { preWeighingId: preWeighing.id });

    expect(response.statusCode).toBe(201);
    expect(response.json().items[0].inputs).toEqual([
      expect.objectContaining({ product: expect.objectContaining({ sku: water.sku }), quantity: "17.9" }),
      expect.objectContaining({ product: expect.objectContaining({ sku: flour.sku }), quantity: "30" }),
    ]);
  });

  it("starts a free item whose intermediate has no recipe", async () => {
    const { headers } = await canCreate();
    const cake = await createProduct("Cake", { kind: "MANUFACTURED" });
    const icing = await createProduct("Icing", { kind: "MANUFACTURED" });

    await testPrisma.recipe.create({
      data: {
        productSku: cake.sku,
        yieldQuantity: "1",
        ingredients: { create: [{ productSku: icing.sku, quantity: "2" }] },
      },
    });

    const response = await postProduction(headers, { items: [{ productSku: cake.sku, quantity: "3" }] });

    expect(response.statusCode).toBe(201);
    expect(response.json().items[0].inputs).toEqual([
      expect.objectContaining({ product: expect.objectContaining({ sku: icing.sku }), quantity: "6" }),
    ]);
  });

  it("takes several free recipes in one production", async () => {
    const { headers } = await canCreate();
    const { dough } = await createDough();
    const { syrup, sugar } = await createSyrup();

    const response = await postProduction(headers, {
      items: [
        { productSku: syrup.sku, quantity: "5" },
        { productSku: dough.sku, quantity: "50" },
      ],
    });

    expect(response.statusCode).toBe(201);
    const items: { product: { sku: string } }[] = response.json().items;
    const bySku = (sku: string) => items.find((item) => item.product.sku === sku);

    expect(items).toHaveLength(2);
    expect(bySku(syrup.sku)).toMatchObject({
      preWeighingId: null,
      expectedQuantity: "5",
      inputs: [{ product: { sku: sugar.sku }, quantity: "2" }],
    });
    expect(bySku(dough.sku)).toMatchObject({ preWeighingId: null, expectedQuantity: "50" });
  });

  it("leaves the stock untouched", async () => {
    const { headers } = await canCreate();
    const { dough, flour } = await createDough();
    await stock(flour.sku, "100", "2");

    await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] });

    expect(await stockOf(flour.sku)).toEqual({ quantity: "100", averageCost: "2" });
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("keeps the inputs it planned when the recipe changes afterwards", async () => {
    const { headers } = await canCreate();
    const { dough } = await createDough();
    await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] });

    await testPrisma.recipeIngredient.updateMany({ data: { quantity: "1" } });

    const inputs = await testPrisma.productionItemInput.findMany();

    expect(inputs.map((input) => input.quantity.toString()).sort()).toEqual(["18", "30"]);
  });

  it("answers 409 for a pre-weighing that already guides a production, and writes nothing", async () => {
    const { headers, userId } = await canCreate();
    const { preWeighing } = await createDoughPreWeighing(userId);
    await postProduction(headers, { preWeighingId: preWeighing.id });

    const response = await postProduction(headers, { preWeighingId: preWeighing.id });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.production.count()).toBe(1);
  });

  describe("guided by a root with its intermediates", () => {
    // A root with a child, which has a child of its own, and a second child of the root.
    async function createTree(userId: string) {
      const product = await createProduct("Tree product");
      const create = (parentId: string | null) =>
        testPrisma.preWeighing.create({
          data: { productSku: product.sku, quantity: "1", createdById: userId, parentId },
        });
      const root = await create(null);
      const child = await create(root.id);
      const grandchild = await create(child.id);
      const sibling = await create(root.id);

      return { root, child, grandchild, sibling };
    }

    it("makes an item of the root and of each pending intermediate, each with its pre-weighing", async () => {
      const { headers, userId } = await canCreate();
      const { root, child, grandchild, sibling } = await createTree(userId);

      const response = await postProduction(headers, { preWeighingId: root.id });

      expect(response.statusCode).toBe(201);
      expect(response.json().items.map((item: { preWeighingId: string }) => item.preWeighingId)).toEqual([
        root.id,
        child.id,
        grandchild.id,
        sibling.id,
      ]);
    });

    it("cuts a branch at an intermediate that is not pending", async () => {
      const { headers, userId } = await canCreate();
      const { root, child, sibling } = await createTree(userId);
      // The child was already produced, by a production of its own.
      await testPrisma.production.create({
        data: {
          createdById: userId,
          items: {
            create: {
              productSku: (await testPrisma.preWeighing.findUniqueOrThrow({ where: { id: child.id } })).productSku,
              preWeighingId: child.id,
              expectedQuantity: "1",
              status: "FINISHED",
            },
          },
        },
      });

      const response = await postProduction(headers, { preWeighingId: root.id });

      expect(response.statusCode).toBe(201);
      expect(response.json().items.map((item: { preWeighingId: string }) => item.preWeighingId)).toEqual([
        root.id,
        sibling.id,
      ]);
    });

    it("refuses a pending intermediate whose parent is pending", async () => {
      const { headers, userId } = await canCreate();
      const { child } = await createTree(userId);

      const response = await postProduction(headers, { preWeighingId: child.id });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toBe("The pre-weighing is not a pending root.");
      expect(await testPrisma.production.count()).toBe(0);
    });

    it("refuses a root that is no longer pending", async () => {
      const { headers, userId } = await canCreate();
      const { root } = await createTree(userId);
      await postProduction(headers, { preWeighingId: root.id });

      const response = await postProduction(headers, { preWeighingId: root.id });

      expect(response.statusCode).toBe(409);
      expect(await testPrisma.production.count()).toBe(1);
    });
  });

  it("answers 404 for a pre-weighing that does not exist", async () => {
    const { headers } = await canCreate();

    expect((await postProduction(headers, { preWeighingId: MISSING_ID })).statusCode).toBe(404);
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await canCreate();

    const response = await postProduction(headers, { items: [{ productSku: MISSING_ID, quantity: "1" }] });

    expect(response.statusCode).toBe(404);
  });

  it("answers 409 when one of the products has no recipe, and writes nothing", async () => {
    const { headers } = await canCreate();
    const { dough } = await createDough();
    const filling = await createProduct("Filling", { kind: "MANUFACTURED" });

    const response = await postProduction(headers, {
      items: [
        { productSku: dough.sku, quantity: "50" },
        { productSku: filling.sku, quantity: "1" },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.production.count()).toBe(0);
  });

  it.each([
    ["no item", () => ({ items: [] })],
    ["a zero quantity", (ids: Ids) => ({ items: [{ productSku: ids.dough, quantity: "0" }] })],
    ["a free item with no quantity", (ids: Ids) => ({ items: [{ productSku: ids.dough }] })],
    [
      "an item that is guided and free at once",
      (ids: Ids) => ({ items: [{ preWeighingId: ids.preWeighing, productSku: ids.dough, quantity: "1" }] }),
    ],
    ["an item that is neither guided nor free", () => ({ items: [{}] })],
    ["a pre-weighing among the items", (ids: Ids) => ({ items: [{ preWeighingId: ids.preWeighing }] })],
    [
      "both shapes at once",
      (ids: Ids) => ({ preWeighingId: ids.preWeighing, items: [{ productSku: ids.dough, quantity: "1" }] }),
    ],
    ["no body", () => ({})],
  ])("answers 400 for %s", async (_label, bodyFor: (ids: Ids) => Record<string, unknown>) => {
    const { headers, userId } = await canCreate();
    const { dough, preWeighing } = await createDoughPreWeighing(userId);

    const response = await postProduction(headers, bodyFor({ dough: dough.sku, preWeighing: preWeighing.id }));

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.production.count()).toBe(0);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await postProduction(headers, {})).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postProduction(undefined, {})).statusCode).toBe(401);
  });
});

describe("GET /v1/productions/:id", () => {
  it("returns the production as it stands", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const started = await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] });

    const response = await getProduction(headers, started.json().id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(started.json());
  });

  it("answers 404 for a production that does not exist", async () => {
    const { headers } = await canRead();

    expect((await getProduction(headers, MISSING_ID)).statusCode).toBe(404);
  });

  it("answers 403 without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect((await getProduction(headers, MISSING_ID)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await getProduction(undefined, MISSING_ID)).statusCode).toBe(401);
  });
});

describe("POST /v1/productions/:id/finish", () => {
  // 50 kg of dough takes 30 kg of flour at 2.00 and 18 L of water at 0.50: 69.00 of inputs.
  async function startDough(headers: Headers) {
    const products = await createDough();
    await stock(products.flour.sku, "100", "2");
    await stock(products.water.sku, "50", "0.5");
    const started = await postProduction(headers, { items: [{ productSku: products.dough.sku, quantity: "50" }] });

    return { ...products, production: started.json() };
  }

  it("writes the inputs off the stock and brings the product in at what they cost", async () => {
    const { headers, userId } = await canDoBoth();
    const { dough, flour, water, production } = await startDough(headers);

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "46" }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: production.id,
      status: "FINISHED",
      finishedAt: expect.any(String),
      items: [
        {
          expectedQuantity: "50",
          producedQuantity: "46",
          unitCost: "1.5",
          inputs: [
            { product: { sku: water.sku }, quantity: "18", unitCost: "0.5" },
            { product: { sku: flour.sku }, quantity: "30", unitCost: "2" },
          ],
        },
      ],
    });
    expect(await getProduction(headers, production.id).then((found) => found.json())).toEqual(response.json());

    expect(await stockOf(flour.sku)).toEqual({ quantity: "70", averageCost: "2" });
    expect(await stockOf(water.sku)).toEqual({ quantity: "32", averageCost: "0.5" });
    expect(await stockOf(dough.sku)).toEqual({ quantity: "46", averageCost: "1.5" });

    const movements = await testPrisma.stockMovement.findMany();
    const summary = movements
      .map((movement) => {
        expect(movement.createdById).toBe(userId);
        return `${movement.type} ${movement.productSku} ${movement.quantity} @ ${movement.unitCost}`;
      })
      .sort();

    expect(summary).toEqual(
      [
        `PRODUCTION_CONSUMPTION ${flour.sku} 30 @ 2`,
        `PRODUCTION_CONSUMPTION ${water.sku} 18 @ 0.5`,
        `PRODUCTION_OUTPUT ${dough.sku} 46 @ 1.5`,
      ].sort(),
    );
  });

  it("writes off what was weighed when a pre-weighing guided the item", async () => {
    const { headers, userId } = await canDoBoth();
    const { flour, water, preWeighing } = await createDoughPreWeighing(userId);
    await stock(flour.sku, "100", "2");
    await stock(water.sku, "50", "0.5");
    const production = (await postProduction(headers, { preWeighingId: preWeighing.id })).json();

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "50" }],
    });

    expect(response.statusCode).toBe(200);
    expect(await stockOf(flour.sku)).toEqual({ quantity: "69.75", averageCost: "2" });
    expect(await stockOf(water.sku)).toEqual({ quantity: "32.1", averageCost: "0.5" });
  });

  it("finishes every item of a production with several recipes", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const { syrup, sugar } = await createSyrup();
    const production = (
      await postProduction(headers, {
        items: [
          { productSku: dough.sku, quantity: "50" },
          { productSku: syrup.sku, quantity: "5" },
        ],
      })
    ).json();
    const [doughItem, syrupItem] = production.items;

    const response = await postFinish(headers, production.id, {
      items: [
        { id: syrupItem.id, producedQuantity: "4.5" },
        { id: doughItem.id, producedQuantity: "48" },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(await stockOf(dough.sku)).toMatchObject({ quantity: "48" });
    expect(await stockOf(syrup.sku)).toMatchObject({ quantity: "4.5" });
    expect(await stockOf(sugar.sku)).toMatchObject({ quantity: "-2" });
  });

  it("lets the balance of an input go negative, and counts no cost for one that never entered", async () => {
    const { headers } = await canDoBoth();
    const { dough, flour, water } = await createDough();
    await stock(flour.sku, "10", "2");
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "50" }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].unitCost).toBe("1.2");
    expect(await stockOf(flour.sku)).toEqual({ quantity: "-20", averageCost: "2" });
    expect(await stockOf(water.sku)).toEqual({ quantity: "-18", averageCost: null });
  });

  describe("taking the inputs from the lots", () => {
    // 5 L of syrup takes 2 kg of sugar.
    async function startSyrup(headers: Headers, lots: [string, string, string | null][]) {
      const products = await createSyrup();
      const sugarLots = await stockInLots(products.sugar.sku, lots);
      const started = await postProduction(headers, { items: [{ productSku: products.syrup.sku, quantity: "5" }] });

      return { ...products, sugarLots, production: started.json() };
    }

    const finish = (headers: Headers, production: { id: string; items: { id: string }[] }, produced = "5") =>
      postFinish(headers, production.id, { items: [{ id: production.items[0]!.id, producedQuantity: produced }] });

    const consumptionsOf = async (productSku: string) =>
      (
        await testPrisma.stockMovement.findMany({
          where: { productSku, type: "PRODUCTION_CONSUMPTION" },
          orderBy: { quantity: "asc" },
        })
      ).map((movement) => ({
        lotId: movement.lotId,
        quantity: movement.quantity.toString(),
        unitCost: movement.unitCost.toString(),
      }));

    it("takes from the lot that expires first, whatever the order they came in", async () => {
      const { headers } = await canDoBoth();
      const { sugar, sugarLots, production } = await startSyrup(headers, [
        ["10", "3", daysFromToday(90)],
        ["10", "5", daysFromToday(20)],
        ["10", "7", null],
      ]);
      const [later, sooner, never] = sugarLots;

      const response = await finish(headers, production);

      expect(response.statusCode).toBe(200);
      expect(await lotQuantity(sooner!.id)).toBe("8");
      expect(await lotQuantity(later!.id)).toBe("10");
      expect(await lotQuantity(never!.id)).toBe("10");
      expect(await consumptionsOf(sugar.sku)).toEqual([{ lotId: sooner!.id, quantity: "2", unitCost: "5" }]);
      expect(response.json().items[0].inputs[0].unitCost).toBe("5");
      expect(response.json().items[0].unitCost).toBe("2");
    });

    it("moves on to the next lot when one does not cover it, costing each part at its own lot", async () => {
      const { headers } = await canDoBoth();
      const { sugar, sugarLots, production } = await startSyrup(headers, [
        ["0.5", "4", daysFromToday(20)],
        ["10", "8", daysFromToday(90)],
      ]);
      const [sooner, later] = sugarLots;

      const response = await finish(headers, production);

      expect(await lotQuantity(sooner!.id)).toBe("0");
      expect(await lotQuantity(later!.id)).toBe("8.5");
      expect(await consumptionsOf(sugar.sku)).toEqual([
        { lotId: sooner!.id, quantity: "0.5", unitCost: "4" },
        { lotId: later!.id, quantity: "1.5", unitCost: "8" },
      ]);
      // 0.5 at 4 and 1.5 at 8 are 14.00 for 2 kg, and for 5 L of syrup.
      expect(response.json().items[0].inputs[0].unitCost).toBe("7");
      expect(response.json().items[0].unitCost).toBe("2.8");
      expect(await stockOf(sugar.sku)).toMatchObject({ quantity: "8.5" });
    });

    it("takes first from the lot that came in first when two expire on the same day", async () => {
      const { headers } = await canDoBoth();
      const { sugarLots, production } = await startSyrup(headers, [
        ["10", "3", daysFromToday(20)],
        ["10", "5", daysFromToday(20)],
      ]);

      await finish(headers, production);

      expect(await lotQuantity(sugarLots[0]!.id)).toBe("8");
      expect(await lotQuantity(sugarLots[1]!.id)).toBe("10");
    });

    it("takes from a lot that expires today, and leaves an expired one alone", async () => {
      const { headers } = await canDoBoth();
      const { sugarLots, production } = await startSyrup(headers, [
        ["10", "3", daysFromToday(-1)],
        ["1", "5", daysFromToday(0)],
        ["10", "7", daysFromToday(60)],
      ]);
      const [expired, today, later] = sugarLots;

      await finish(headers, production);

      expect(await lotQuantity(expired!.id)).toBe("10");
      expect(await lotQuantity(today!.id)).toBe("0");
      expect(await lotQuantity(later!.id)).toBe("9");
    });

    it("empties every lot and leaves the rest owed, at the cost of the last lot it took from", async () => {
      const { headers } = await canDoBoth();
      const { sugar, sugarLots, production } = await startSyrup(headers, [
        ["0.5", "4", daysFromToday(20)],
        ["1", "8", daysFromToday(90)],
      ]);

      const response = await finish(headers, production);

      expect(response.statusCode).toBe(200);
      expect(await lotQuantity(sugarLots[0]!.id)).toBe("0");
      expect(await lotQuantity(sugarLots[1]!.id)).toBe("0");
      expect(await stockOf(sugar.sku)).toMatchObject({ quantity: "-0.5" });
      expect(await consumptionsOf(sugar.sku)).toEqual([
        { lotId: sugarLots[0]!.id, quantity: "0.5", unitCost: "4" },
        { lotId: null, quantity: "0.5", unitCost: "8" },
        { lotId: sugarLots[1]!.id, quantity: "1", unitCost: "8" },
      ]);
      // 0.5 at 4, 1 at 8 and the 0.5 owed at 8 are 14.00 for 2 kg.
      expect(response.json().items[0].inputs[0].unitCost).toBe("7");
    });

    it("costs what is owed at the newest lot the product had when no lot is left to take from", async () => {
      const { headers } = await canDoBoth();
      const { sugar, production } = await startSyrup(headers, [["10", "3", daysFromToday(-1)]]);
      await testPrisma.stockLot.create({
        data: { productSku: sugar.sku, quantity: "0", initialQuantity: "5", unitCost: "6" },
      });

      const response = await finish(headers, production);

      expect(await consumptionsOf(sugar.sku)).toEqual([{ lotId: null, quantity: "2", unitCost: "6" }]);
      expect(response.json().items[0].inputs[0].unitCost).toBe("6");
    });
  });

  describe("bringing the product in as a lot", () => {
    it("opens a lot of what was produced, with its expiry date and what it cost", async () => {
      const { headers } = await canDoBoth();
      const { dough, production } = await startDough(headers);

      const response = await postFinish(headers, production.id, {
        items: [{ id: production.items[0].id, producedQuantity: "46", expiresAt: daysFromToday(3) }],
      });

      expect(response.statusCode).toBe(200);

      const [produced] = await testPrisma.stockLot.findMany({ where: { productSku: dough.sku } });

      expect(produced).toMatchObject({ supplierId: null });
      expect(produced!.expiresAt?.toISOString().slice(0, 10)).toBe(daysFromToday(3));
      expect(produced!.initialQuantity.toString()).toBe("46");
      expect(produced!.quantity.toString()).toBe("46");
      expect(produced!.unitCost.toString()).toBe("1.5");
      expect((await testPrisma.stockMovement.findFirstOrThrow({ where: { type: "PRODUCTION_OUTPUT" } })).lotId).toBe(
        produced!.id,
      );
    });

    it("opens a lot that never expires when told so", async () => {
      const { headers } = await canDoBoth();
      const { dough, production } = await startDough(headers);

      await postFinish(headers, production.id, {
        items: [{ id: production.items[0].id, producedQuantity: "46", expiresAt: null }],
      });

      expect((await testPrisma.stockLot.findFirstOrThrow({ where: { productSku: dough.sku } })).expiresAt).toBeNull();
    });

    it("answers 400 when an item does not say whether what it produced expires", async () => {
      const { headers } = await canDoBoth();
      const { production } = await startDough(headers);

      const response = await inject(productionFinish, {
        method: "POST",
        url: `/v1/productions/${production.id}/finish`,
        params: { id: production.id },
        headers,
        payload: { items: [{ id: production.items[0].id, producedQuantity: "46" }] },
      });

      expect(response.statusCode).toBe(400);
    });

    it("answers 400 for a product that would come in already expired", async () => {
      const { headers } = await canDoBoth();
      const { production } = await startDough(headers);

      const response = await postFinish(headers, production.id, {
        items: [{ id: production.items[0].id, producedQuantity: "46", expiresAt: daysFromToday(-1) }],
      });

      expect(response.statusCode).toBe(400);
    });
  });

  it("weights what it produced into the average cost of the product already in stock", async () => {
    const { headers } = await canDoBoth();
    const { dough, production } = await startDough(headers);
    await stock(dough.sku, "46", "3");

    await postFinish(headers, production.id, { items: [{ id: production.items[0].id, producedQuantity: "46" }] });

    expect(await stockOf(dough.sku)).toEqual({ quantity: "92", averageCost: "2.25" });
  });

  it("answers 409 for a production that is already finished, and moves the stock only once", async () => {
    const { headers } = await canDoBoth();
    const { flour, production } = await startDough(headers);
    const payload = { items: [{ id: production.items[0].id, producedQuantity: "46" }] };
    await postFinish(headers, production.id, payload);

    const response = await postFinish(headers, production.id, payload);

    expect(response.statusCode).toBe(409);
    expect(await stockOf(flour.sku)).toMatchObject({ quantity: "70" });
    expect(await testPrisma.stockMovement.count()).toBe(3);
  });

  it("finishes only the items it is given, and closes the production with the last one", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const { syrup, sugar } = await createSyrup();
    const production = (
      await postProduction(headers, {
        items: [
          { productSku: dough.sku, quantity: "50" },
          { productSku: syrup.sku, quantity: "5" },
        ],
      })
    ).json();
    const [doughItem, syrupItem] = production.items;

    const first = await postFinish(headers, production.id, {
      items: [{ id: doughItem.id, producedQuantity: "48" }],
      hasLeftoversInCost: false,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      status: "IN_PROGRESS",
      finishedAt: null,
      items: [
        { id: doughItem.id, status: "FINISHED", finishedAt: expect.any(String), hasLeftoversInCost: false },
        { id: syrupItem.id, status: "PENDING", finishedAt: null, hasLeftoversInCost: null },
      ],
    });
    expect(await stockOf(dough.sku)).toMatchObject({ quantity: "48" });
    expect(await stockOf(sugar.sku)).toBeNull();

    const last = await postFinish(headers, production.id, { items: [{ id: syrupItem.id, producedQuantity: "4.5" }] });

    expect(last.statusCode).toBe(200);
    expect(last.json()).toMatchObject({
      status: "FINISHED",
      finishedAt: expect.any(String),
      items: [
        { status: "FINISHED", hasLeftoversInCost: false },
        { status: "FINISHED", hasLeftoversInCost: true },
      ],
    });
    expect(await stockOf(sugar.sku)).toMatchObject({ quantity: "-2" });
  });

  it("answers 409 when the items bring one of another production, and moves nothing", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const { syrup } = await createSyrup();
    const production = (
      await postProduction(headers, {
        items: [
          { productSku: dough.sku, quantity: "50" },
          { productSku: syrup.sku, quantity: "5" },
        ],
      })
    ).json();

    const response = await postFinish(headers, production.id, {
      items: [
        { id: production.items[0].id, producedQuantity: "46" },
        { id: MISSING_ID, producedQuantity: "4" },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The items do not match the items of the production." });
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect((await testPrisma.production.findUniqueOrThrow({ where: { id: production.id } })).status).toBe(
      "IN_PROGRESS",
    );
  });

  it("answers 409 when the cost of a produced unit does not fit, and undoes what it had moved", async () => {
    const { headers } = await canDoBoth();
    const { dough, flour } = await createDough();
    await stock(flour.sku, "100", "900000000000");
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "0.000001" }],
    });

    expect(response.statusCode).toBe(409);
    expect(await stockOf(flour.sku)).toMatchObject({ quantity: "100" });
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect((await getProduction(headers, production.id)).json()).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("answers 404 for a production that does not exist", async () => {
    const { headers } = await canCreate();

    const response = await postFinish(headers, MISSING_ID, { items: [{ id: MISSING_ID, producedQuantity: "1" }] });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ["no item", () => []],
    ["a zero produced quantity", (id: string) => [{ id, producedQuantity: "0" }]],
    ["a missing produced quantity", (id: string) => [{ id }]],
    [
      "the same item twice",
      (id: string) => [
        { id, producedQuantity: "1" },
        { id, producedQuantity: "2" },
      ],
    ],
  ])("answers 400 for %s", async (_label, itemsFor: (id: string) => unknown[]) => {
    const { headers } = await canDoBoth();
    const { production } = await startDough(headers);

    const response = await postFinish(headers, production.id, { items: itemsFor(production.items[0].id) });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await postFinish(headers, MISSING_ID, {})).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postFinish(undefined, MISSING_ID, {})).statusCode).toBe(401);
  });
});

describe("finishing a product with intermediates", () => {
  // 50 bonbons take 1 kg of filling (0.3 in stock, 0.7 to produce), 50 shells and 0.25 kg of
  // sprinkles; the filling is made of condensed milk and chocolate, the shells of chocolate. With
  // `chocolateInCans`, the chocolate cannot be kept once opened and its lot is ten cans of 1 kg.
  async function bonbonTree(userId: string, { chocolateInCans = false } = {}) {
    const [bonbon, filling, shell, sprinkles, milk, chocolate] = await Promise.all([
      createProduct("Bonbon", { kind: "MANUFACTURED", unit: "UNIT" }),
      createProduct("Filling", { kind: "MANUFACTURED" }),
      createProduct("Shell", { kind: "MANUFACTURED", unit: "UNIT" }),
      createProduct("Sprinkles"),
      createProduct("Condensed milk"),
      createProduct("Chocolate"),
    ]);
    const recipe = (
      productSku: string,
      yieldQuantity: string,
      ingredients: { productSku: string; quantity: string }[],
    ) => testPrisma.recipe.create({ data: { productSku, yieldQuantity, ingredients: { create: ingredients } } });

    await recipe(bonbon.sku, "10", [
      { productSku: filling.sku, quantity: "0.2" },
      { productSku: shell.sku, quantity: "10" },
      { productSku: sprinkles.sku, quantity: "0.05" },
    ]);
    await recipe(filling.sku, "1", [
      { productSku: milk.sku, quantity: "0.8" },
      { productSku: chocolate.sku, quantity: "0.2" },
    ]);
    await recipe(shell.sku, "100", [{ productSku: chocolate.sku, quantity: "1" }]);
    await stock(filling.sku, "0.3", "1");
    await stock(milk.sku, "10", "2");
    await stock(chocolate.sku, "10", "10");
    await stock(sprinkles.sku, "10", "4");

    if (chocolateInCans) {
      const can = await testPrisma.productPackaging.create({
        data: { productSku: chocolate.sku, brand: "CACAU", content: "1" },
      });
      await testPrisma.product.update({ where: { sku: chocolate.sku }, data: { isStorableOnceOpened: false } });
      await testPrisma.stockLot.updateMany({
        where: { productSku: chocolate.sku },
        data: { packagingId: can.id, packageCount: 10, packagePrice: "10" },
      });
    }

    const root = await testPrisma.preWeighing.create({
      data: {
        productSku: bonbon.sku,
        quantity: "50",
        createdById: userId,
        items: {
          create: [
            { productSku: filling.sku, plannedQuantity: "1" },
            { productSku: shell.sku, plannedQuantity: "50" },
            { productSku: sprinkles.sku, plannedQuantity: "0.25", weighedQuantity: "0.25" },
          ],
        },
      },
    });
    const fillingStage = await testPrisma.preWeighing.create({
      data: {
        productSku: filling.sku,
        quantity: "0.7",
        createdById: userId,
        parentId: root.id,
        items: {
          create: [
            { productSku: milk.sku, plannedQuantity: "0.56", weighedQuantity: "0.56" },
            { productSku: chocolate.sku, plannedQuantity: "0.14", weighedQuantity: "0.14" },
          ],
        },
      },
    });
    const shellStage = await testPrisma.preWeighing.create({
      data: {
        productSku: shell.sku,
        quantity: "50",
        createdById: userId,
        parentId: root.id,
        items: { create: [{ productSku: chocolate.sku, plannedQuantity: "0.5", weighedQuantity: "0.5" }] },
      },
    });

    return { bonbon, filling, shell, sprinkles, milk, chocolate, root, fillingStage, shellStage };
  }

  // A production of a single item for each pre-weighing, written as the productions started before
  // a start brought a root with all its intermediates were: the shortage stories need a bombom
  // that waits for no item of its own production.
  async function startOneEach(preWeighingIds: string[]) {
    const records = await testPrisma.preWeighing.findMany({
      where: { id: { in: preWeighingIds } },
      include: { items: true },
    });
    const createdById = (await testPrisma.user.findFirstOrThrow()).id;
    const production = await testPrisma.production.create({
      data: {
        createdById,
        items: {
          create: preWeighingIds.map((preWeighingId) => {
            const record = records.find((found) => found.id === preWeighingId)!;

            return {
              productSku: record.productSku,
              preWeighingId,
              expectedQuantity: record.quantity,
              inputs: {
                create: record.items.map((line) => ({
                  productSku: line.productSku,
                  quantity: line.weighedQuantity ?? line.plannedQuantity,
                })),
              },
            };
          }),
        },
      },
      include: { items: true },
    });

    return {
      id: production.id,
      items: preWeighingIds.map((preWeighingId) =>
        production.items.find((item) => item.preWeighingId === preWeighingId)!,
      ),
    };
  }

  // The whole tree started from its root: one production holding the bombom, the filling and the
  // shells, each item found by the pre-weighing that guides it.
  async function startTree(
    headers: Headers,
    tree: { root: { id: string }; fillingStage: { id: string }; shellStage: { id: string } },
  ) {
    const production = (await postProduction(headers, { preWeighingId: tree.root.id })).json();
    const itemOf = (preWeighingId: string) =>
      production.items.find((item: { preWeighingId: string }) => item.preWeighingId === preWeighingId) as {
        id: string;
      };

    return {
      id: production.id as string,
      bonbonItem: itemOf(tree.root.id),
      fillingItem: itemOf(tree.fillingStage.id),
      shellItem: itemOf(tree.shellStage.id),
    };
  }

  const finishAs = (headers: Headers, production: { id: string; items: { id: string }[] }, produced: string[]) =>
    postFinish(headers, production.id, {
      items: production.items.map((item, index) => ({ id: item.id, producedQuantity: produced[index] })),
    });

  const finishItems = (headers: Headers, productionId: string, items: [{ id: string }, string][], body = {}) =>
    postFinish(headers, productionId, {
      items: items.map(([item, producedQuantity]) => ({ id: item.id, producedQuantity })),
      ...body,
    });

  const shortageMessage = "Not enough of an intermediate in stock.";

  it("presents what each item of the tree depends on", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);

    const items = (await getProduction(headers, id)).json().items;

    expect(items).toEqual([
      expect.objectContaining({ id: bonbonItem.id, dependsOn: [fillingItem.id, shellItem.id], awaitsWeighing: false }),
      expect.objectContaining({ id: fillingItem.id, dependsOn: [], awaitsWeighing: false }),
      expect.objectContaining({ id: shellItem.id, dependsOn: [], awaitsWeighing: false }),
    ]);
  });

  it("finishes the filling and the shells together, sharing an opened can, and stays in progress", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId, { chocolateInCans: true });
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);

    const response = await finishItems(headers, id, [
      [fillingItem, "0.7"],
      [shellItem, "50"],
    ]);

    // One can opened for 0.14 + 0.5 kg: 0.36 kg left, split by what each took. The filling costs
    // (0.56 × 2 + 0.14 × 10 + 0.07875 × 10) ÷ 0.7 and the shells (0.5 × 10 + 0.28125 × 10) ÷ 50.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "IN_PROGRESS",
      finishedAt: null,
      items: [
        { id: bonbonItem.id, status: "PENDING", finishedAt: null, hasLeftoversInCost: null },
        {
          id: fillingItem.id,
          status: "FINISHED",
          finishedAt: expect.any(String),
          hasLeftoversInCost: true,
          unitCost: "4.725",
        },
        {
          id: shellItem.id,
          status: "FINISHED",
          finishedAt: expect.any(String),
          hasLeftoversInCost: true,
          unitCost: "0.15625",
        },
      ],
    });
    const leftovers = await testPrisma.productionLeftover.findMany({ orderBy: { quantity: "asc" } });
    expect(leftovers.map(({ quantity }) => quantity.toString())).toEqual(["0.07875", "0.28125"]);
    expect(await stockOf(tree.chocolate.sku)).toMatchObject({ quantity: "9" });
    expect(await stockOf(tree.bonbon.sku)).toBeNull();
  });

  it("refuses the bombom while the shells are pending, naming them, and moves nothing", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
    await finishItems(headers, id, [[fillingItem, "0.7"]]);
    const movements = await testPrisma.stockMovement.count();

    const response = await finishItems(headers, id, [[bonbonItem, "50"]]);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: "An item waits for another item of the production.",
      waitingFor: [
        {
          itemId: bonbonItem.id,
          product: { sku: tree.bonbon.sku, description: "Bonbon", unit: "UNIT" },
          waitsFor: [{ itemId: shellItem.id, product: { sku: tree.shell.sku, description: "Shell", unit: "UNIT" } }],
        },
      ],
    });
    expect(await testPrisma.stockMovement.count()).toBe(movements);
    expect((await getProduction(headers, id)).json()).toMatchObject({
      status: "IN_PROGRESS",
      items: [{ status: "PENDING" }, { status: "FINISHED" }, { status: "PENDING" }],
    });
  });

  it("refuses the bombom finished together with what it waits for", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);

    const response = await finishItems(headers, id, [
      [bonbonItem, "50"],
      [fillingItem, "0.7"],
      [shellItem, "50"],
    ]);

    expect(response.statusCode).toBe(409);
    expect(response.json().waitingFor).toEqual([
      expect.objectContaining({
        itemId: bonbonItem.id,
        waitsFor: [
          expect.objectContaining({ itemId: fillingItem.id }),
          expect.objectContaining({ itemId: shellItem.id }),
        ],
      }),
    ]);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("finishes the bombom after both, closing the production with the lots they made", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
    const finished = (
      await finishItems(headers, id, [
        [fillingItem, "0.7"],
        [shellItem, "50"],
      ])
    ).json();

    const response = await finishItems(headers, id, [[bonbonItem, "50"]]);

    // The filling made costs (0.56 × 2 + 0.14 × 10) ÷ 0.7 = 3.6 and the shells 0.5 × 10 ÷ 50 = 0.1;
    // the bonbons take 0.3 of filling at 1 and 0.7 at 3.6, 50 shells and 0.25 of sprinkles at 4:
    // (0.3 + 2.52 + 5 + 1) ÷ 50.
    expect(finished.items.map((item: { unitCost: string | null }) => item.unitCost)).toEqual([null, "3.6", "0.1"]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "FINISHED",
      finishedAt: expect.any(String),
      items: [
        { id: bonbonItem.id, status: "FINISHED", unitCost: "0.1764" },
        { status: "FINISHED" },
        { status: "FINISHED" },
      ],
    });
    expect(await stockOf(tree.filling.sku)).toMatchObject({ quantity: "0" });
    expect(await stockOf(tree.shell.sku)).toMatchObject({ quantity: "0" });
    const madeLots = await testPrisma.stockLot.findMany({
      where: { productSku: { in: [tree.filling.sku, tree.shell.sku] }, unitCost: { in: ["3.6", "0.1"] } },
    });
    expect(madeLots.map(({ quantity }) => quantity.toString())).toEqual(["0", "0"]);
  });

  it("cancels after the filling finished: its lot stays and its pre-weighing is produced, the others are free", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, fillingItem } = await startTree(headers, tree);
    await finishItems(headers, id, [[fillingItem, "0.7"]]);
    const fillingStock = await stockOf(tree.filling.sku);

    const response = await postCancel(headers, id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "CANCELED", canceledAt: expect.any(String) });
    expect(await stockOf(tree.filling.sku)).toEqual(fillingStock);
    expect((await getPreWeighing(headers, tree.fillingStage.id)).json()).toMatchObject({ status: "PRODUCED" });
    expect((await getPreWeighing(headers, tree.root.id)).json()).toMatchObject({ status: "PENDING" });
    expect((await getPreWeighing(headers, tree.shellStage.id)).json()).toMatchObject({ status: "PENDING" });
  });

  it("refuses an item already finished, and moves nothing", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, fillingItem } = await startTree(headers, tree);
    await finishItems(headers, id, [[fillingItem, "0.7"]]);
    const movements = await testPrisma.stockMovement.count();

    const response = await finishItems(headers, id, [[fillingItem, "0.7"]]);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The item is not pending." });
    expect(await testPrisma.stockMovement.count()).toBe(movements);
  });

  it("refuses an item that waits for a new weighing, and moves nothing", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, fillingItem } = await startTree(headers, tree);
    // A damage took the filling's pre-weighing away: the item waits for a new one.
    const reason = await testPrisma.lossReason.create({ data: { name: "Queimou" } });
    await testPrisma.productionItem.update({ where: { id: fillingItem.id }, data: { preWeighingId: null } });
    await testPrisma.productionItemDamage.create({
      data: {
        productionItemId: fillingItem.id,
        preWeighingId: tree.fillingStage.id,
        reasonId: reason.id,
        createdById: userId,
      },
    });

    const response = await finishItems(headers, id, [[fillingItem, "0.7"]]);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The item waits for a new weighing." });
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect((await getProduction(headers, id)).json().items[1]).toMatchObject({
      id: fillingItem.id,
      awaitsWeighing: true,
    });
  });

  describe("POST /v1/productions/:id/items/:itemId/damage", () => {
    const burnt = () => testPrisma.lossReason.create({ data: { name: "Queimou" } });

    it("writes the filling's inputs off as losses, lets go of its pre-weighing, and keeps the bombom waiting", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem } = await startTree(headers, tree);
      const reason = await burnt();

      const response = await postDamage(headers, id, fillingItem.id, { reasonId: reason.id, note: "Grudou na panela" });

      expect(response.statusCode).toBe(200);
      const [bonbon, filling] = response.json().items;
      expect(filling).toMatchObject({
        id: fillingItem.id,
        status: "PENDING",
        preWeighingId: null,
        awaitsWeighing: true,
        expectedQuantity: "0.7",
        damages: [
          {
            id: expect.any(String),
            reason: { id: reason.id, name: "Queimou" },
            note: "Grudou na panela",
            createdAt: expect.any(String),
            preWeighingId: tree.fillingStage.id,
          },
        ],
      });
      expect(filling.inputs.map((input: { quantity: string }) => input.quantity)).toEqual(["0.14", "0.56"]);
      expect(bonbon).toMatchObject({ id: bonbonItem.id, dependsOn: expect.arrayContaining([fillingItem.id]) });

      const damageId = filling.damages[0].id;
      const losses = await testPrisma.stockLoss.findMany({
        include: { movement: true, lot: true },
        orderBy: { movement: { quantity: "asc" } },
      });
      expect(
        losses.map(({ reasonId, damageId: lossDamageId, note, createdById, movement, lot }) => ({
          reasonId,
          damageId: lossDamageId,
          note,
          createdById,
          type: movement.type,
          movesItsLot: movement.lotId === lot.id,
          productSku: lot.productSku,
          quantity: movement.quantity.toString(),
          unitCost: movement.unitCost?.toString(),
        })),
      ).toEqual([
        {
          reasonId: reason.id,
          damageId,
          note: "Grudou na panela",
          createdById: userId,
          type: "LOSS",
          movesItsLot: true,
          productSku: tree.chocolate.sku,
          quantity: "0.14",
          unitCost: "10",
        },
        {
          reasonId: reason.id,
          damageId,
          note: "Grudou na panela",
          createdById: userId,
          type: "LOSS",
          movesItsLot: true,
          productSku: tree.milk.sku,
          quantity: "0.56",
          unitCost: "2",
        },
      ]);
      expect(await testPrisma.stockMovement.count()).toBe(2);
      expect(await stockOf(tree.chocolate.sku)).toMatchObject({ quantity: "9.86" });
      expect(await stockOf(tree.milk.sku)).toMatchObject({ quantity: "9.44" });
      expect(await stockOf(tree.filling.sku)).toMatchObject({ quantity: "0.3" });
      expect((await getPreWeighing(headers, tree.fillingStage.id)).json()).toMatchObject({ status: "DAMAGED" });
    });

    it("refuses to finish the filling until it is weighed again", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const reason = await burnt();
      await postDamage(headers, id, fillingItem.id, { reasonId: reason.id });

      const finish = await finishItems(headers, id, [[fillingItem, "0.7"]]);
      const again = await postDamage(headers, id, fillingItem.id, { reasonId: reason.id });

      expect(finish.json()).toEqual({ message: "The item waits for a new weighing." });
      expect(again.statusCode).toBe(409);
      expect(again.json()).toEqual({ message: "The item waits for a new weighing." });
      expect(await testPrisma.productionItemDamage.count()).toBe(1);
    });

    it("damages a free item, which stays pending and can be made again", async () => {
      const { headers } = await canDoBoth();
      const { dough, flour, water } = await createDough();
      await stock(flour.sku, "100", "2");
      await stock(water.sku, "100", "0.01");
      const started = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
      const itemId = started.items[0].id;
      const reason = await burnt();

      const response = await postDamage(headers, started.id, itemId, { reasonId: reason.id });

      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toMatchObject({
        status: "PENDING",
        awaitsWeighing: false,
        damages: [{ reason: { id: reason.id, name: "Queimou" }, note: null, preWeighingId: null }],
      });
      expect(await testPrisma.stockLoss.count({ where: { reasonId: reason.id } })).toBe(2);
      expect(await stockOf(flour.sku)).toMatchObject({ quantity: "70" });

      const finished = await postFinish(headers, started.id, { items: [{ id: itemId, producedQuantity: "50" }] });

      expect(finished.statusCode).toBe(200);
      expect(finished.json()).toMatchObject({ status: "FINISHED", items: [{ status: "FINISHED" }] });
      expect(await stockOf(flour.sku)).toMatchObject({ quantity: "40" });
    });

    it("writes off an input spread over two lots as one loss per lot, each at its lot's cost, under one damage", async () => {
      const { headers } = await canDoBoth();
      const { dough, flour, water } = await createDough();
      await testPrisma.productStock.create({
        data: { productSku: flour.sku, quantity: "120", averageCost: "2.8", lastEntryCost: "3" },
      });
      // The one to expire first goes first: 20 of the 30 kg of flour from it, the other 10 from the next.
      const later = await lot(flour.sku, "100", "3", daysFromToday(20));
      const sooner = await lot(flour.sku, "20", "2", daysFromToday(5));
      await stock(water.sku, "100", "0.01");
      const started = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
      const reason = await burnt();

      const response = await postDamage(headers, started.id, started.items[0].id, { reasonId: reason.id });

      expect(response.statusCode).toBe(200);
      const damageId = response.json().items[0].damages[0].id;
      const losses = await testPrisma.stockLoss.findMany({
        where: { lot: { productSku: flour.sku } },
        include: { movement: true },
        orderBy: { movement: { quantity: "desc" } },
      });
      expect(
        losses.map(({ damageId: lossDamageId, lotId, movement }) => ({
          damageId: lossDamageId,
          lotId,
          quantity: movement.quantity.toString(),
          unitCost: movement.unitCost?.toString(),
        })),
      ).toEqual([
        { damageId, lotId: sooner.id, quantity: "20", unitCost: "2" },
        { damageId, lotId: later.id, quantity: "10", unitCost: "3" },
      ]);
      expect((await testPrisma.stockLot.findUnique({ where: { id: sooner.id } }))!.quantity.toString()).toBe("0");
      expect((await testPrisma.stockLot.findUnique({ where: { id: later.id } }))!.quantity.toString()).toBe("90");
    });

    it("writes off what no lot holds as a loss movement alone", async () => {
      const { headers } = await canDoBoth();
      const { dough, flour, water } = await createDough();
      const started = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
      const reason = await burnt();

      const response = await postDamage(headers, started.id, started.items[0].id, { reasonId: reason.id });

      expect(response.statusCode).toBe(200);
      const movements = await testPrisma.stockMovement.findMany({ orderBy: { quantity: "asc" } });
      expect(movements.map(({ type, lotId, quantity }) => ({ type, lotId, quantity: quantity.toString() }))).toEqual([
        { type: "LOSS", lotId: null, quantity: "18" },
        { type: "LOSS", lotId: null, quantity: "30" },
      ]);
      expect(await testPrisma.stockLoss.count()).toBe(0);
      expect(await stockOf(flour.sku)).toMatchObject({ quantity: "-30" });
      expect(await stockOf(water.sku)).toMatchObject({ quantity: "-18" });
    });

    it("refuses an item already finished, and moves nothing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      await finishItems(headers, id, [[fillingItem, "0.7"]]);
      const movements = await testPrisma.stockMovement.count();
      const reason = await burnt();

      const response = await postDamage(headers, id, fillingItem.id, { reasonId: reason.id });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The item is not pending." });
      expect(await testPrisma.stockMovement.count()).toBe(movements);
      expect(await testPrisma.productionItemDamage.count()).toBe(0);
    });

    it("refuses the bombom while the shells are pending, naming them, and moves nothing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
      await finishItems(headers, id, [[fillingItem, "0.7"]]);
      const movements = await testPrisma.stockMovement.count();
      const reason = await burnt();

      const response = await postDamage(headers, id, bonbonItem.id, { reasonId: reason.id });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        message: "An item waits for another item of the production.",
        waitingFor: [
          {
            itemId: bonbonItem.id,
            product: { sku: tree.bonbon.sku, description: "Bonbon", unit: "UNIT" },
            waitsFor: [{ itemId: shellItem.id, product: { sku: tree.shell.sku, description: "Shell", unit: "UNIT" } }],
          },
        ],
      });
      expect(await testPrisma.stockMovement.count()).toBe(movements);
      expect(await testPrisma.productionItemDamage.count()).toBe(0);
    });

    it("refuses an inactive reason, and moves nothing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const reason = await testPrisma.lossReason.create({ data: { name: "Antigo", isActive: false } });

      const response = await postDamage(headers, id, fillingItem.id, { reasonId: reason.id });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "Loss reason is inactive." });
      expect(await testPrisma.stockMovement.count()).toBe(0);
      expect(await testPrisma.stockLoss.count()).toBe(0);
      expect(await testPrisma.productionItemDamage.count()).toBe(0);
      expect(await stockOf(tree.milk.sku)).toMatchObject({ quantity: "10" });
      expect((await getProduction(headers, id)).json().items[1]).toMatchObject({
        preWeighingId: tree.fillingStage.id,
        awaitsWeighing: false,
        damages: [],
      });
    });

    it("answers 404 for a reason that does not exist", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);

      const response = await postDamage(headers, id, fillingItem.id, { reasonId: MISSING_ID });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: "Loss reason not found." });
      expect(await testPrisma.stockMovement.count()).toBe(0);
    });

    it("answers 404 for an item that is not of the production, and for a missing production", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const reason = await burnt();

      const missingItem = await postDamage(headers, id, MISSING_ID, { reasonId: reason.id });
      const missingProduction = await postDamage(headers, MISSING_ID, fillingItem.id, { reasonId: reason.id });

      expect(missingItem.statusCode).toBe(404);
      expect(missingItem.json()).toEqual({ message: "Production item not found." });
      expect(missingProduction.statusCode).toBe(404);
      expect(missingProduction.json()).toEqual({ message: "Production not found." });
    });

    it("lets only one of a finish and a damage of the same item sent together through", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const reason = await burnt();

      const [finish, damage] = await Promise.all([
        finishItems(headers, id, [[fillingItem, "0.7"]]),
        postDamage(headers, id, fillingItem.id, { reasonId: reason.id }),
      ]);

      // Both hold the production, so one runs after the other and sees what it wrote: a damage after
      // the finish finds the item finished, a finish after the damage finds it waiting for a weighing.
      expect([finish.statusCode, damage.statusCode].sort()).toEqual([200, 409]);
      if (finish.statusCode === 200) {
        expect(damage.json()).toEqual({ message: "The item is not pending." });
        expect(await testPrisma.productionItemDamage.count()).toBe(0);
      } else {
        expect(finish.json()).toEqual({ message: "The item waits for a new weighing." });
        expect(await testPrisma.productionItem.count({ where: { status: "FINISHED" } })).toBe(0);
      }
    });

    it("answers 400 for a reason that is not a uuid, or a note too long", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const reason = await burnt();

      expect((await postDamage(headers, id, fillingItem.id, { reasonId: "burnt" })).statusCode).toBe(400);
      expect(
        (await postDamage(headers, id, fillingItem.id, { reasonId: reason.id, note: "x".repeat(501) })).statusCode,
      ).toBe(400);
    });

    it("requires the permission to create productions", async () => {
      const { headers } = await canRead();

      const response = await postDamage(headers, MISSING_ID, MISSING_ID, { reasonId: MISSING_ID });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("POST /v1/productions/:id/weighings", () => {
    const burnt = () => testPrisma.lossReason.create({ data: { name: "Queimou" } });

    type Tree = Awaited<ReturnType<typeof bonbonTree>>;

    // A filling weighed again: condensed milk and chocolate, both weighed.
    const fillingBody = (tree: Tree, quantity: string, milk: string, chocolate: string) => ({
      productSku: tree.filling.sku,
      quantity,
      items: [
        { productSku: tree.milk.sku, weighedQuantity: milk },
        { productSku: tree.chocolate.sku, weighedQuantity: chocolate },
      ],
    });

    const newPreWeighingOf = (productSku: string, except: string[]) =>
      testPrisma.preWeighing.findFirstOrThrow({ where: { productSku, id: { notIn: except } } });

    it("re-guides the damaged filling with the new weighing, recorded where the damaged one was, and lets it finish", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
      await postDamage(headers, id, fillingItem.id, { reasonId: (await burnt()).id });

      const response = await postWeighing(headers, id, {
        itemId: fillingItem.id,
        ...fillingBody(tree, "0.5", "0.4", "0.1"),
      });

      expect(response.statusCode).toBe(200);
      const weighed = await newPreWeighingOf(tree.filling.sku, [tree.fillingStage.id]);
      expect(weighed.parentId).toBe(tree.root.id);
      const items = response.json().items;
      expect(items.map((item: { id: string }) => item.id)).toEqual([bonbonItem.id, fillingItem.id, shellItem.id]);
      expect(items[1]).toMatchObject({
        id: fillingItem.id,
        status: "PENDING",
        preWeighingId: weighed.id,
        awaitsWeighing: false,
        expectedQuantity: "0.5",
        damages: [{ preWeighingId: tree.fillingStage.id }],
      });
      expect(items[1].inputs.map(({ quantity }: { quantity: string }) => quantity)).toEqual(["0.1", "0.4"]);
      expect((await getPreWeighing(headers, tree.fillingStage.id)).json()).toMatchObject({ status: "DAMAGED" });
      expect((await getPreWeighing(headers, weighed.id)).json()).toMatchObject({ status: "IN_PRODUCTION" });

      const finished = await finishItems(headers, id, [[fillingItem, "0.5"]]);

      expect(finished.statusCode).toBe(200);
      expect(finished.json().items[1]).toMatchObject({ id: fillingItem.id, status: "FINISHED" });
      expect(await stockOf(tree.milk.sku)).toMatchObject({ quantity: "9.04" });
    });

    it("brings the stages of a new weighing of the bombom in as new items it waits for", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
      await finishItems(headers, id, [
        [fillingItem, "0.7"],
        [shellItem, "50"],
      ]);
      await postDamage(headers, id, bonbonItem.id, { reasonId: (await burnt()).id });

      // The damage took the 1 kg of filling there was: a new 50 bombons make 1 kg of it again, and
      // take the shells from stock.
      const response = await postWeighing(headers, id, {
        itemId: bonbonItem.id,
        productSku: tree.bonbon.sku,
        quantity: "50",
        items: [
          { productSku: tree.filling.sku },
          { productSku: tree.shell.sku },
          { productSku: tree.sprinkles.sku, weighedQuantity: "0.25" },
        ],
        stages: [fillingBody(tree, "1", "0.8", "0.2")],
      });

      expect(response.statusCode).toBe(200);
      const root = await newPreWeighingOf(tree.bonbon.sku, [tree.root.id]);
      const stage = await newPreWeighingOf(tree.filling.sku, [tree.fillingStage.id]);
      expect(root.parentId).toBeNull();
      expect(stage.parentId).toBe(root.id);
      const items = response.json().items;
      expect(items).toHaveLength(4);
      const added = items.find((item: { preWeighingId: string }) => item.preWeighingId === stage.id);
      expect(added).toMatchObject({ status: "PENDING", expectedQuantity: "1", awaitsWeighing: false });
      expect(items.find((item: { id: string }) => item.id === bonbonItem.id)).toMatchObject({
        preWeighingId: root.id,
        awaitsWeighing: false,
        dependsOn: expect.arrayContaining([fillingItem.id, shellItem.id, added.id]),
      });
    });

    it("adds the complement of a shortage as an item the bombom now waits for", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const production = await startOneEach([tree.root.id]);
      const bonbonItem = production.items[0]!;
      const short = await finishItems(headers, production.id, [[bonbonItem, "50"]]);
      expect(short.json()).toMatchObject({ message: shortageMessage });

      const response = await postWeighing(headers, production.id, {
        parentId: tree.root.id,
        ...fillingBody(tree, "0.7", "0.56", "0.14"),
      });

      expect(response.statusCode).toBe(200);
      const complement = await newPreWeighingOf(tree.filling.sku, [tree.fillingStage.id]);
      expect(complement.parentId).toBe(tree.root.id);
      const items = response.json().items;
      const added = items.find((item: { preWeighingId: string }) => item.preWeighingId === complement.id);
      expect(added).toMatchObject({
        status: "PENDING",
        product: { sku: tree.filling.sku },
        expectedQuantity: "0.7",
        dependsOn: [],
      });
      expect(added.inputs.map(({ quantity }: { quantity: string }) => quantity)).toEqual(["0.14", "0.56"]);
      expect(items.find((item: { id: string }) => item.id === bonbonItem.id)).toMatchObject({
        dependsOn: [added.id],
      });
      expect((await getPreWeighing(headers, complement.id)).json()).toMatchObject({ status: "IN_PRODUCTION" });
    });

    it("refuses an item that does not wait for a new weighing, and records nothing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const before = await testPrisma.preWeighing.count();

      const response = await postWeighing(headers, id, {
        itemId: fillingItem.id,
        ...fillingBody(tree, "0.7", "0.56", "0.14"),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The item does not wait for a new weighing." });
      expect(await testPrisma.preWeighing.count()).toBe(before);
    });

    it("refuses a weighing that does not match the recipe, and leaves the item as it was", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      await postDamage(headers, id, fillingItem.id, { reasonId: (await burnt()).id });
      const before = await testPrisma.preWeighing.count();

      const response = await postWeighing(headers, id, {
        itemId: fillingItem.id,
        productSku: tree.filling.sku,
        quantity: "0.7",
        items: [{ productSku: tree.milk.sku, weighedQuantity: "0.56" }],
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The items do not match the ingredients of the recipe." });
      expect(await testPrisma.preWeighing.count()).toBe(before);
      const item = (await getProduction(headers, id))
        .json()
        .items.find((found: { id: string }) => found.id === fillingItem.id);
      expect(item).toMatchObject({ preWeighingId: null, awaitsWeighing: true, expectedQuantity: "0.7" });
      expect(item.inputs.map(({ quantity }: { quantity: string }) => quantity)).toEqual(["0.14", "0.56"]);
    });

    it("refuses a weighing of another product than the item's", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      await postDamage(headers, id, fillingItem.id, { reasonId: (await burnt()).id });
      const before = await testPrisma.preWeighing.count();

      const response = await postWeighing(headers, id, {
        itemId: fillingItem.id,
        productSku: tree.shell.sku,
        quantity: "50",
        items: [{ productSku: tree.chocolate.sku, weighedQuantity: "0.5" }],
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The product does not match the item." });
      expect(await testPrisma.preWeighing.count()).toBe(before);
    });

    it("refuses a parent that guides no pending item of the production", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      await finishItems(headers, id, [[fillingItem, "0.7"]]);
      const before = await testPrisma.preWeighing.count();

      const finishedParent = await postWeighing(headers, id, {
        parentId: tree.fillingStage.id,
        ...fillingBody(tree, "0.7", "0.56", "0.14"),
      });
      const missingParent = await postWeighing(headers, id, {
        parentId: MISSING_ID,
        ...fillingBody(tree, "0.7", "0.56", "0.14"),
      });

      for (const response of [finishedParent, missingParent]) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ message: "The parent is not a pending item of the production." });
      }
      expect(await testPrisma.preWeighing.count()).toBe(before);
    });

    it("refuses a complement of a product the parent's item does not take", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id } = await startTree(headers, tree);
      const before = await testPrisma.preWeighing.count();

      const response = await postWeighing(headers, id, {
        parentId: tree.fillingStage.id,
        productSku: tree.shell.sku,
        quantity: "50",
        items: [{ productSku: tree.chocolate.sku, weighedQuantity: "0.5" }],
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The parent's recipe does not take this product." });
      expect(await testPrisma.preWeighing.count()).toBe(before);
    });

    it("refuses a production that is not in progress, and records nothing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id } = await startTree(headers, tree);
      await postCancel(headers, id);
      const before = await testPrisma.preWeighing.count();

      const response = await postWeighing(headers, id, {
        parentId: tree.root.id,
        ...fillingBody(tree, "0.7", "0.56", "0.14"),
      });
      const missing = await postWeighing(headers, MISSING_ID, {
        parentId: tree.root.id,
        ...fillingBody(tree, "0.7", "0.56", "0.14"),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "Production is not in progress." });
      expect(missing.statusCode).toBe(404);
      expect(await testPrisma.preWeighing.count()).toBe(before);
    });

    it("answers 400 unless exactly one of the item and the parent is sent", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const body = fillingBody(tree, "0.7", "0.56", "0.14");

      expect((await postWeighing(headers, id, body)).statusCode).toBe(400);
      expect(
        (await postWeighing(headers, id, { ...body, itemId: fillingItem.id, parentId: tree.root.id })).statusCode,
      ).toBe(400);
    });

    it("requires the permission to create productions", async () => {
      const { headers } = await canRead();

      const response = await postWeighing(headers, MISSING_ID, { itemId: MISSING_ID });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("previewing the leftovers of some items", () => {
    const preview = (headers: Headers, id: string, items?: string[]) =>
      inject(productionLeftovers, {
        method: "GET",
        url: `/v1/productions/${id}/leftovers`,
        params: { id },
        headers,
        query: { items },
      });

    it("previews only the items asked for", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId, { chocolateInCans: true });
      const { id, fillingItem } = await startTree(headers, tree);

      const response = await preview(headers, id, [fillingItem.id]);

      // The filling alone opens a can for 0.14 kg: 0.86 kg left at 10.
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [
          {
            itemId: fillingItem.id,
            leftovers: [
              {
                product: { sku: tree.chocolate.sku, description: "Chocolate", unit: "KILOGRAM" },
                lotId: expect.any(String),
                quantity: "0.86",
                unitCost: "10",
                cost: "8.60",
              },
            ],
          },
        ],
        totalCost: "8.60",
      });
    });

    it("previews every pending item when none is asked for", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId, { chocolateInCans: true });
      const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);

      const response = await preview(headers, id);

      expect(response.statusCode).toBe(200);
      expect(response.json().items.map(({ itemId }: { itemId: string }) => itemId)).toEqual([
        bonbonItem.id,
        fillingItem.id,
        shellItem.id,
      ]);
      expect(response.json().totalCost).toBe("3.60");

      await finishItems(headers, id, [[fillingItem, "0.7"]]);
      const after = await preview(headers, id);

      expect(after.json().items.map(({ itemId }: { itemId: string }) => itemId)).toEqual([bonbonItem.id, shellItem.id]);
      expect(after.json().totalCost).toBe("5.00");
    });

    it("refuses an item that is not of the production, or not pending", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId, { chocolateInCans: true });
      const { id, fillingItem } = await startTree(headers, tree);

      const foreign = await preview(headers, id, [MISSING_ID]);

      expect(foreign.statusCode).toBe(409);
      expect(foreign.json()).toEqual({ message: "The items do not match the items of the production." });

      await finishItems(headers, id, [[fillingItem, "0.7"]]);
      const finished = await preview(headers, id, [fillingItem.id]);

      expect(finished.statusCode).toBe(409);
      expect(finished.json()).toEqual({ message: "The item is not pending." });
    });

    it("answers 400 for an item id that is not a uuid", async () => {
      const { headers, userId } = await canDoBoth();
      const { id } = await startTree(headers, await bonbonTree(userId));

      expect((await preview(headers, id, ["not-an-id"])).statusCode).toBe(400);
    });
  });

  describe("substituting an intermediate", () => {
    it("previews the need of the pending items against the stock", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);

      const response = await getSubstitution(headers, id, fillingItem.id);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        product: { sku: tree.filling.sku, description: "Filling", unit: "KILOGRAM" },
        needed: "1",
        available: "0.3",
      });
    });

    it("substitutes the filling, releasing its pre-weighing and moving nothing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const movements = await testPrisma.stockMovement.count();

      const response = await postSubstitute(headers, id, fillingItem.id);

      expect(response.statusCode).toBe(200);
      const items = response.json().items;
      expect(items.find((item: { id: string }) => item.id === fillingItem.id)).toMatchObject({
        status: "SUBSTITUTED",
        preWeighingId: null,
      });
      expect(response.json().status).toBe("IN_PROGRESS");
      expect(await testPrisma.stockMovement.count()).toBe(movements);
      const released = await getPreWeighing(headers, tree.fillingStage.id);
      expect(released.json()).toMatchObject({ status: "PENDING" });
    });

    it("leaves the bombom to the shortage check at its finish", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
      await postSubstitute(headers, id, fillingItem.id);
      await finishItems(headers, id, [[shellItem, "50"]]);

      const response = await finishItems(headers, id, [[bonbonItem, "50"]]);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        message: shortageMessage,
        shortages: [{ product: { sku: tree.filling.sku }, needed: "1", available: "0.3" }],
      });
    });

    it("refuses to substitute the bombom, which nothing takes", async () => {
      const { headers, userId } = await canDoBoth();
      const { id, bonbonItem } = await startTree(headers, await bonbonTree(userId));

      const response = await postSubstitute(headers, id, bonbonItem.id);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "Only an intermediate can be substituted." });
      expect((await getSubstitution(headers, id, bonbonItem.id)).statusCode).toBe(409);
    });

    it("refuses an item that is not pending, or not of the production", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      await postSubstitute(headers, id, fillingItem.id);

      const again = await postSubstitute(headers, id, fillingItem.id);
      const missing = await postSubstitute(headers, id, MISSING_ID);

      expect(again.statusCode).toBe(409);
      expect(again.json()).toEqual({ message: "The item is not pending." });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ message: "Production item not found." });
    });

    it("finishes the production when the substituted item was the last pending one", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
      // The bombom and the shells were resolved elsewhere (older productions finish item by item).
      await testPrisma.productionItem.updateMany({
        where: { id: { in: [bonbonItem.id, shellItem.id] } },
        data: { status: "FINISHED" },
      });

      const response = await postSubstitute(headers, id, fillingItem.id);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "FINISHED", finishedAt: expect.any(String) });
    });
  });

  it("finishes a bombom made alone when the stock covers its intermediates", async () => {
    const { headers, userId } = await canDoBoth();
    const { root, filling, shell } = await bonbonTree(userId);
    await testPrisma.productStock.update({ where: { productSku: filling.sku }, data: { quantity: "1" } });
    await lot(filling.sku, "0.7", "1");
    await stock(shell.sku, "50", "0.1");
    const bonbon = await startOneEach([root.id]);

    const response = await finishAs(headers, bonbon, ["50"]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "FINISHED" });
    expect(await stockOf(filling.sku)).toMatchObject({ quantity: "0" });
  });

  it("answers a canceled intermediate with the shortage it leaves", async () => {
    const { headers, userId } = await canDoBoth();
    const { root, filling, fillingStage, shellStage } = await bonbonTree(userId);
    const fillingProduction = await startOneEach([fillingStage.id]);
    await postCancel(headers, fillingProduction.id);
    await finishAs(headers, await startOneEach([shellStage.id]), ["50"]);
    const bonbon = await startOneEach([root.id]);
    const movements = await testPrisma.stockMovement.count();

    const response = await finishAs(headers, bonbon, ["50"]);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      message: shortageMessage,
      shortages: [{ product: { sku: filling.sku }, needed: "1", available: "0.3" }],
    });
    expect(response.json()).not.toHaveProperty("pendingPreWeighings");
    expect(await testPrisma.stockMovement.count()).toBe(movements);
  });

  it("refuses to finish when the intermediate yielded less", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
    await finishItems(headers, id, [
      [fillingItem, "0.5"],
      [shellItem, "50"],
    ]);
    const movements = await testPrisma.stockMovement.count();

    const response = await finishItems(headers, id, [[bonbonItem, "50"]]);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: shortageMessage,
      shortages: [
        {
          itemId: bonbonItem.id,
          product: { sku: tree.filling.sku, description: "Filling", unit: "KILOGRAM" },
          needed: "1",
          available: "0.8",
        },
      ],
      items: [{ itemId: bonbonItem.id, maxQuantity: "40" }],
    });
    expect(await testPrisma.stockMovement.count()).toBe(movements);
    expect(await stockOf(tree.filling.sku)).toMatchObject({ quantity: "0.8" });
    expect((await getProduction(headers, id)).json()).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("sums an intermediate taken by two items of the production", async () => {
    const { headers, userId } = await canDoBoth();
    const { bonbon, filling, shell } = await bonbonTree(userId);
    await stock(shell.sku, "50", "0.1");
    await testPrisma.productStock.update({ where: { productSku: filling.sku }, data: { quantity: "0.8" } });
    await lot(filling.sku, "0.5", "1");
    const production = (
      await postProduction(headers, {
        items: [
          { productSku: bonbon.sku, quantity: "25" },
          { productSku: bonbon.sku, quantity: "25" },
        ],
      })
    ).json();

    const response = await finishAs(headers, production, ["25", "25"]);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      message: shortageMessage,
      shortages: production.items.map((item: { id: string }) => ({
        itemId: item.id,
        product: { sku: filling.sku },
        needed: "0.5",
        available: "0.8",
      })),
      // Each item gets the share of the stock its need is of the whole: 0.8 × 0.5 ÷ 1 = 0.4, which
      // makes 20 of the 25.
      items: production.items.map((item: { id: string }) => ({ itemId: item.id, maxQuantity: "20" })),
    });
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  describe("POST /v1/productions/:id/items/:itemId/reduce", () => {
    // The bonbon production after its intermediates yielded less: 0.8 of filling for 50 bonbons that
    // take 1.
    async function bonbonShort() {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
      await finishItems(headers, id, [
        [fillingItem, "0.5"],
        [shellItem, "50"],
      ]);
      // Only the bombom is left to finish.
      const production = { id, items: [bonbonItem] };

      return { headers, production, itemId: bonbonItem.id, ...tree };
    }

    const inputsOf = async (headers: Headers, id: string) =>
      Object.fromEntries(
        (await getProduction(headers, id))
          .json()
          .items[0].inputs.map((input: { product: { description: string }; quantity: string }) => [
            input.product.description,
            input.quantity,
          ]),
      );

    it("reduces the item and scales every input", async () => {
      const { headers, production, itemId } = await bonbonShort();

      const response = await postReduce(headers, production.id, itemId, { quantity: "40" });

      expect(response.statusCode).toBe(200);
      expect(response.json().items[0].expectedQuantity).toBe("40");
      expect(await inputsOf(headers, production.id)).toEqual({ Sprinkles: "0.2", Filling: "0.8", Shell: "40" });
    });

    it("finds the item by an id written in capitals", async () => {
      const { headers, production, itemId } = await bonbonShort();

      const response = await postReduce(headers, production.id, itemId.toUpperCase(), { quantity: "40" });

      expect(response.statusCode).toBe(200);
      expect(response.json().items[0].expectedQuantity).toBe("40");
    });

    it("reduces again from the current quantity", async () => {
      const { headers, production, itemId } = await bonbonShort();
      await postReduce(headers, production.id, itemId, { quantity: "40" });

      const response = await postReduce(headers, production.id, itemId, { quantity: "20" });

      expect(response.statusCode).toBe(200);
      expect(await inputsOf(headers, production.id)).toEqual({ Sprinkles: "0.1", Filling: "0.4", Shell: "20" });
    });

    it("then finishes with what the stock has", async () => {
      const { headers, production, itemId, filling } = await bonbonShort();
      expect((await finishAs(headers, production, ["50"])).statusCode).toBe(409);
      await postReduce(headers, production.id, itemId, { quantity: "40" });

      const response = await finishAs(headers, production, ["40"]);

      expect(response.statusCode).toBe(200);
      expect(await stockOf(filling.sku)).toMatchObject({ quantity: "0" });
    });

    it("refuses a quantity not below the expected one", async () => {
      const { headers, production, itemId } = await bonbonShort();

      for (const quantity of ["50", "60"]) {
        const response = await postReduce(headers, production.id, itemId, { quantity });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ message: "The quantity must be less than the expected quantity." });
      }
      expect(await inputsOf(headers, production.id)).toMatchObject({ Filling: "1" });
    });

    it("refuses fractional units", async () => {
      const { headers, production, itemId } = await bonbonShort();

      const response = await postReduce(headers, production.id, itemId, { quantity: "39.5" });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The quantity has more decimal places than the unit allows." });
      expect(await inputsOf(headers, production.id)).toMatchObject({ Filling: "1" });
    });

    it("refuses a production not in progress", async () => {
      const { headers, production, itemId } = await bonbonShort();
      await postCancel(headers, production.id);

      const response = await postReduce(headers, production.id, itemId, { quantity: "40" });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "Production is not in progress." });
      expect(await inputsOf(headers, production.id)).toMatchObject({ Filling: "1" });
    });

    it("refuses a missing production", async () => {
      const { headers, itemId } = await bonbonShort();

      const response = await postReduce(headers, MISSING_ID, itemId, { quantity: "40" });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: "Production not found." });
    });

    it("refuses an item of another production", async () => {
      const { headers, production, filling } = await bonbonShort();
      const other = (await postProduction(headers, { items: [{ productSku: filling.sku, quantity: "1" }] })).json();

      const response = await postReduce(headers, production.id, other.items[0].id, { quantity: "40" });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: "Production item not found." });
    });

    it("refuses an item already finished, and leaves it as it was", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      await finishItems(headers, id, [[fillingItem, "0.7"]]);

      const response = await postReduce(headers, id, fillingItem.id, { quantity: "0.5" });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The item is not pending." });
      const filling = (await getProduction(headers, id)).json().items[1];
      expect(filling).toMatchObject({ id: fillingItem.id, expectedQuantity: "0.7" });
      expect(filling.inputs.map((input: { quantity: string }) => input.quantity)).toEqual(["0.14", "0.56"]);
    });

    it("refuses when an input would round to nothing", async () => {
      const { headers, production, itemId, sprinkles } = await bonbonShort();
      await testPrisma.productionItemInput.updateMany({
        where: { productionItemId: itemId, productSku: sprinkles.sku },
        data: { quantity: "0.000001" },
      });

      const response = await postReduce(headers, production.id, itemId, { quantity: "10" });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "Quantity is out of range for this recipe." });
      expect(await inputsOf(headers, production.id)).toMatchObject({ Filling: "1" });
    });

    it("requires the permission to create productions", async () => {
      const { production, itemId } = await bonbonShort();
      const { headers: reader } = await authenticateAs([Permission.PRODUCTION_READ], "reader");

      const response = await postReduce(reader, production.id, itemId, { quantity: "40" });

      expect(response.statusCode).toBe(403);
    });
  });
});

describe("POST /v1/productions/:id/cancel", () => {
  it("cancels a production in progress and leaves the stock untouched", async () => {
    const { headers } = await canDoBoth();
    const { dough, flour } = await createDough();
    await stock(flour.sku, "100", "2");
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();

    const response = await postCancel(headers, production.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...production, status: "CANCELED", canceledAt: expect.any(String) });
    expect((await getProduction(headers, production.id)).json()).toEqual(response.json());
    expect(await stockOf(flour.sku)).toEqual({ quantity: "100", averageCost: "2" });
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("frees the pre-weighing that guided it for another production", async () => {
    const { headers, userId } = await canDoBoth();
    const { preWeighing } = await createDoughPreWeighing(userId);
    const production = (await postProduction(headers, { preWeighingId: preWeighing.id })).json();

    const canceled = await postCancel(headers, production.id);
    const again = await postProduction(headers, { preWeighingId: preWeighing.id });

    expect(canceled.json().items[0].preWeighingId).toBeNull();
    expect(again.statusCode).toBe(201);
    expect(again.json().items[0].preWeighingId).toBe(preWeighing.id);
  });

  it("answers 409 for a production that is already canceled", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
    await postCancel(headers, production.id);

    expect((await postCancel(headers, production.id)).statusCode).toBe(409);
  });

  it("answers 409 for a finished production, and keeps it finished and guided", async () => {
    const { headers, userId } = await canDoBoth();
    const { preWeighing } = await createDoughPreWeighing(userId);
    const production = (await postProduction(headers, { preWeighingId: preWeighing.id })).json();
    await postFinish(headers, production.id, { items: [{ id: production.items[0].id, producedQuantity: "50" }] });

    const response = await postCancel(headers, production.id);

    expect(response.statusCode).toBe(409);
    expect((await getProduction(headers, production.id)).json()).toMatchObject({
      status: "FINISHED",
      canceledAt: null,
      items: [{ preWeighingId: preWeighing.id }],
    });
  });

  it("keeps a canceled production from finishing, and moves nothing", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
    await postCancel(headers, production.id);

    const response = await postFinish(headers, production.id, {
      items: [{ id: production.items[0].id, producedQuantity: "50" }],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("answers 404 for a production that does not exist", async () => {
    const { headers } = await canCreate();

    expect((await postCancel(headers, MISSING_ID)).statusCode).toBe(404);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await postCancel(headers, MISSING_ID)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postCancel(undefined, MISSING_ID)).statusCode).toBe(401);
  });
});

describe("GET /v1/productions", () => {
  // Three productions, started a day apart, named from the oldest to the newest.
  async function startThree(headers: Headers) {
    const { dough } = await createDough();
    const ids: string[] = [];

    for (const day of ["01", "02", "03"]) {
      const { id } = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
      await testPrisma.production.update({ where: { id }, data: { createdAt: new Date(`2026-10-${day}T12:00:00Z`) } });
      ids.push(id);
    }

    return ids;
  }

  const idsOf = (response: { json: () => { items: { id: string }[] } }) => response.json().items.map(({ id }) => id);

  it("lists the productions, the newest first, each as it stands", async () => {
    const { headers } = await canDoBoth();
    const [first, second, third] = await startThree(headers);

    const response = await listProductions(headers);

    expect(response.statusCode).toBe(200);
    expect(idsOf(response)).toEqual([third, second, first]);
    expect(response.json().nextCursor).toBeNull();
    expect(response.json().items[0]).toEqual((await getProduction(headers, third!)).json());
  });

  it("lists only the productions in the status asked for", async () => {
    const { headers } = await canDoBoth();
    const [first, second, third] = await startThree(headers);
    await postCancel(headers, second!);

    expect(idsOf(await listProductions(headers, { status: "IN_PROGRESS" }))).toEqual([third, first]);
    expect(idsOf(await listProductions(headers, { status: "CANCELED" }))).toEqual([second]);
    expect(idsOf(await listProductions(headers, { status: "FINISHED" }))).toEqual([]);
  });

  it("hands the list out in pages, each pointing to the next", async () => {
    const { headers } = await canDoBoth();
    const [first, second, third] = await startThree(headers);

    const page = await listProductions(headers, { limit: "2" });

    expect(idsOf(page)).toEqual([third, second]);
    expect(page.json().nextCursor).toBe(second);

    const next = await listProductions(headers, { limit: "2", cursor: page.json().nextCursor });

    expect(idsOf(next)).toEqual([first]);
    expect(next.json().nextCursor).toBeNull();
  });

  it.each([
    ["a zero limit", { limit: "0" }],
    ["a limit above a hundred", { limit: "101" }],
    ["a limit that is not a number", { limit: "many" }],
    ["a cursor that is not an id", { cursor: "next" }],
    ["a status that does not exist", { status: "PAUSED" }],
  ])("answers 400 for %s", async (_label, query: Record<string, string>) => {
    const { headers } = await canRead();

    expect((await listProductions(headers, query)).statusCode).toBe(400);
  });

  it("answers 403 without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect((await listProductions(headers)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await listProductions(undefined)).statusCode).toBe(401);
  });
});

type Ids = { dough: string; preWeighing: string };

describe("finishing two productions that share inputs at the same time", () => {
  // A product made of one unit of each of its ingredients.
  async function createMade(description: string, ingredientSkus: string[]) {
    const product = await createProduct(description, { kind: "MANUFACTURED" });

    await testPrisma.recipe.create({
      data: {
        productSku: product.sku,
        yieldQuantity: "1",
        ingredients: { create: ingredientSkus.map((productSku) => ({ productSku, quantity: "1" })) },
      },
    });

    return product;
  }

  async function startOf(headers: Headers, productSkus: string[]) {
    const production = (
      await postProduction(headers, { items: productSkus.map((productSku) => ({ productSku, quantity: "1" })) })
    ).json();

    return {
      id: production.id as string,
      items: production.items.map((item: { id: string }) => ({ id: item.id, producedQuantity: "1" })),
    };
  }

  async function waitingForALock(sessions: number) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ waiting }] = await testPrisma.$queryRaw<[{ waiting: number }]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      `;

      if (waiting >= sessions) return;

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error("The productions never got to wait for the stock.");
  }

  it("finishes both, whatever the order each of them reaches the inputs in", async () => {
    const { headers } = await canDoBoth();
    const sugar = await createProduct("Sugar");
    const flour = await createProduct("Flour");
    const egg = await createProduct("Egg");
    const milk = await createProduct("Milk");

    // The first reaches sugar, then egg, then flour; the second flour, then milk, then sugar.
    const syrup = await createMade("Alpha syrup", [sugar.sku]);
    const dough = await createMade("Beta dough", [egg.sku, flour.sku]);
    const mix = await createMade("Gamma mix", [flour.sku, milk.sku, sugar.sku]);
    const first = await startOf(headers, [syrup.sku, dough.sku]);
    const second = await startOf(headers, [mix.sku]);

    // Egg and milk are held by something else just long enough for each production to stop
    // halfway, holding the input the other is about to ask for.
    await testPrisma.productStock.createMany({
      data: [egg, milk].map(({ sku }) => ({ productSku: sku, quantity: "0" })),
    });

    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = () => {};
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const gate = testPrisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1 FROM product_stocks WHERE product_sku IN (${egg.sku}::uuid, ${milk.sku}::uuid) FOR UPDATE
      `;
      held();
      await released;
    });
    await holding;

    const finishing = [first, second].map(({ id, items }) => postFinish(headers, id, { items }));

    await waitingForALock(2);
    release();
    await gate;

    expect((await Promise.all(finishing)).map((response) => response.statusCode)).toEqual([200, 200]);
  });
});

describe("leftovers of opened packagings", () => {
  // A pudding of 1 kg takes 300 g of condensed milk, bought in cans of 395 g at 0.02 a gram.
  async function startPudding(
    headers: Headers,
    { storable = false, packaged = true, withFlan = false, dose = "300" } = {},
  ) {
    const pudding = await createProduct("Pudding", { kind: "MANUFACTURED" });
    const milk = await testPrisma.product.create({
      data: { description: "Condensed milk", kind: "GOODS", unit: "GRAM", isStorableOnceOpened: storable },
    });
    const can = await testPrisma.productPackaging.create({
      data: { productSku: milk.sku, brand: "MOÇA", content: "395" },
    });
    await testPrisma.recipe.create({
      data: {
        productSku: pudding.sku,
        yieldQuantity: "1",
        ingredients: { create: [{ productSku: milk.sku, quantity: dose }] },
      },
    });
    await testPrisma.productStock.create({
      data: { productSku: milk.sku, quantity: "3950", averageCost: "0.02", lastEntryCost: "0.02" },
    });
    const milkLot = await testPrisma.stockLot.create({
      data: {
        productSku: milk.sku,
        initialQuantity: "3950",
        quantity: "3950",
        unitCost: "0.02",
        ...(packaged ? { packagingId: can.id, packageCount: 10, packagePrice: "7.90" } : {}),
      },
    });
    const made = [pudding];

    if (withFlan) {
      const flan = await createProduct("Flan", { kind: "MANUFACTURED" });
      await testPrisma.recipe.create({
        data: {
          productSku: flan.sku,
          yieldQuantity: "1",
          ingredients: { create: [{ productSku: milk.sku, quantity: dose }] },
        },
      });
      made.push(flan);
    }

    const started = await postProduction(headers, {
      items: made.map(({ sku }) => ({ productSku: sku, quantity: "1" })),
    });

    return { milk, milkLot, production: started.json() };
  }

  const finishAll = (headers: Headers, production: { id: string; items: { id: string }[] }, body = {}) =>
    postFinish(headers, production.id, {
      items: production.items.map(({ id }) => ({ id, producedQuantity: "1" })),
      ...body,
    });

  it("discards what is left of the opened can and puts its cost into what was produced", async () => {
    const { headers } = await canDoBoth();
    const { milk, milkLot, production } = await startPudding(headers);

    const response = await finishAll(headers, production);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          unitCost: "7.9",
          hasLeftoversInCost: true,
          status: "FINISHED",
          inputs: [{ leftovers: [{ lotId: milkLot.id, quantity: "95", unitCost: "0.02" }] }],
        },
      ],
    });
    expect(await lotQuantity(milkLot.id)).toBe("3555");
    expect(await stockOf(milk.sku)).toMatchObject({ quantity: "3555" });
    const discarded = await testPrisma.stockMovement.findMany({ where: { type: "OPENED_LEFTOVER" } });
    expect(discarded.map(({ lotId, quantity }) => ({ lotId, quantity: quantity.toString() }))).toEqual([
      { lotId: milkLot.id, quantity: "95" },
    ]);
    expect(await testPrisma.productionLeftover.count()).toBe(1);
  });

  it("discards it and keeps its cost out of what was produced when asked to", async () => {
    const { headers } = await canDoBoth();
    const { production } = await startPudding(headers);

    const response = await finishAll(headers, production, { hasLeftoversInCost: false });

    expect(response.json()).toMatchObject({ items: [{ unitCost: "6", hasLeftoversInCost: false }] });
  });

  it("discards nothing of what can be kept once opened, nor of a lot received loose", async () => {
    const { headers } = await canDoBoth();
    const storable = await startPudding(headers, { storable: true });

    await finishAll(headers, storable.production);
    expect(await lotQuantity(storable.milkLot.id)).toBe("3650");

    await resetDatabase();
    const again = await canDoBoth();
    const loose = await startPudding(again.headers, { packaged: false });

    await finishAll(again.headers, loose.production);
    expect(await lotQuantity(loose.milkLot.id)).toBe("3650");
    expect(await testPrisma.productionLeftover.count()).toBe(0);
  });

  it("lets the items of a production share an opened can, splitting what is left by what each took", async () => {
    // A flan and a pudding finished together, 100 g each, out of the same can lot: one can is opened
    // for 200 g, so 195 g are left, half for each.
    const { headers } = await canDoBoth();
    const { milkLot, production } = await startPudding(headers, { withFlan: true, dose: "100" });

    const response = await finishAll(headers, production);

    expect(await lotQuantity(milkLot.id)).toBe("3555");
    const leftovers = await testPrisma.productionLeftover.findMany();
    expect(leftovers.map(({ quantity }) => quantity.toString())).toEqual(["97.5", "97.5"]);
    expect(response.json().items.map(({ unitCost }: { unitCost: string }) => unitCost)).toEqual(["3.95", "3.95"]);
  });

  it("previews the shared can the same way", async () => {
    const { headers } = await canDoBoth();
    const { production } = await startPudding(headers, { withFlan: true, dose: "100" });

    const response = await inject(productionLeftovers, {
      method: "GET",
      url: `/v1/productions/${production.id}/leftovers`,
      params: { id: production.id },
      headers,
    });

    expect(response.json().totalCost).toBe("3.90");
  });

  it("discards only what the lot leaves when the production takes beyond it, and owes the rest", async () => {
    const { headers } = await canDoBoth();
    const { milk, milkLot, production } = await startPudding(headers, { dose: "4000" });

    const response = await finishAll(headers, production);

    expect(response.statusCode).toBe(200);
    expect(await lotQuantity(milkLot.id)).toBe("0");
    expect(await testPrisma.productionLeftover.count()).toBe(0);
    expect(await stockOf(milk.sku)).toMatchObject({ quantity: "-50" });
  });

  it("previews the leftovers without moving the stock, and only while the production is in progress", async () => {
    const { headers } = await canDoBoth();
    const { milkLot, production } = await startPudding(headers);
    const preview = () =>
      inject(productionLeftovers, {
        method: "GET",
        url: `/v1/productions/${production.id}/leftovers`,
        params: { id: production.id },
        headers,
      });

    const response = await preview();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          itemId: production.items[0].id,
          leftovers: [
            {
              product: expect.objectContaining({ description: "Condensed milk" }),
              lotId: milkLot.id,
              quantity: "95",
              unitCost: "0.02",
              cost: "1.90",
            },
          ],
        },
      ],
      totalCost: "1.90",
    });
    expect(await lotQuantity(milkLot.id)).toBe("3950");

    await finishAll(headers, production);
    expect((await preview()).statusCode).toBe(409);
  });
});
