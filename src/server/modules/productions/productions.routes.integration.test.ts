import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeasurementUnit, Permission, ProductKind } from "@prisma/client";
import * as productionCancel from "@/app/v1/productions/[id]/cancel/route";
import * as productionDamage from "@/app/v1/productions/[id]/items/[itemId]/damage/route";
import * as productionSubstitute from "@/app/v1/productions/[id]/items/[itemId]/substitute/route";
import * as productionBatches from "@/app/v1/productions/[id]/items/[itemId]/batches/route";
import * as productionBatchById from "@/app/v1/productions/[id]/items/[itemId]/batches/[batchId]/route";
import * as productionConclude from "@/app/v1/productions/[id]/items/[itemId]/conclude/route";
import * as productionItemWeighings from "@/app/v1/productions/[id]/items/[itemId]/weighings/route";
import * as productionItems from "@/app/v1/productions/[id]/items/route";
import * as productionLeftovers from "@/app/v1/productions/[id]/leftovers/route";
import * as productionById from "@/app/v1/productions/[id]/route";
import * as productions from "@/app/v1/productions/route";
import * as preWeighingById from "@/app/v1/pre-weighings/[id]/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { collectRoutes } from "@/server/routes";
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

const postConclude = (headers: Headers, id: string, itemId: string, payload: Record<string, unknown> = {}) =>
  inject(productionConclude, {
    method: "POST",
    url: `/v1/productions/${id}/items/${itemId}/conclude`,
    params: { id, itemId },
    headers,
    payload,
  });

// An item made in one batch of what it produced, then concluded, a yield below its target taken as
// meant: what finishing an item was before batches. A batch refused is the answer.
async function makeItem(
  headers: Headers,
  id: string,
  itemId: string,
  quantity: string,
  { expiresAt = null, ...body }: { expiresAt?: string | null; hasLeftoversInCost?: boolean } = {},
) {
  const batch = await postBatch(headers, id, itemId, { quantity, expiresAt, source: "PRODUCED" });

  if (batch.statusCode !== 201) return batch;

  return postConclude(headers, id, itemId, { belowTarget: true, ...body });
}

const postDamage = (headers: Headers, id: string, itemId: string, payload: Record<string, unknown>) =>
  inject(productionDamage, {
    method: "POST",
    url: `/v1/productions/${id}/items/${itemId}/damage`,
    params: { id, itemId },
    headers,
    payload,
  });

const postItemWeighing = (headers: Headers, id: string, itemId: string, payload: Record<string, unknown>) =>
  inject(productionItemWeighings, {
    method: "POST",
    url: `/v1/productions/${id}/items/${itemId}/weighings`,
    params: { id, itemId },
    headers,
    payload,
  });

const postItem = (headers: Headers, id: string, payload: Record<string, unknown>) =>
  inject(productionItems, { method: "POST", url: `/v1/productions/${id}/items`, params: { id }, headers, payload });

const postSubstitute = (headers: Headers, id: string, itemId: string) =>
  inject(productionSubstitute, {
    method: "POST",
    url: `/v1/productions/${id}/items/${itemId}/substitute`,
    params: { id, itemId },
    headers,
  });

const postBatch = (headers: Headers, id: string, itemId: string, payload: Record<string, unknown>) =>
  inject(productionBatches, {
    method: "POST",
    url: `/v1/productions/${id}/items/${itemId}/batches`,
    params: { id, itemId },
    headers,
    payload,
  });

const deleteBatch = (headers: Headers, id: string, itemId: string, batchId: string) =>
  inject(productionBatchById, {
    method: "DELETE",
    url: `/v1/productions/${id}/items/${itemId}/batches/${batchId}`,
    params: { id, itemId, batchId },
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

const deletePreWeighing = (headers: Headers, id: string) =>
  inject(preWeighingById, { method: "DELETE", url: `/v1/pre-weighings/${id}`, params: { id }, headers });

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
          substitutedAt: null,
          weighedAt: null,
          product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
          preWeighingId: null,
          expectedQuantity: "50",
          producedQuantity: null,
          unitCost: null,
          dependsOn: [],
          awaitsWeighing: false,
          damages: [],
          batches: [],
          extraWeighings: 0,
          extraWeighedAt: [],
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
        weighedAt: preWeighing.createdAt.toISOString(),
        substitutedAt: null,
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

  it("presents the batches of an item, oldest first, and the extra weighings it took, when each was recorded", async () => {
    const { headers, userId } = await canDoBoth();
    const { dough } = await createDough();
    const created = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
    const item = created.items[0];
    const batch = (quantity: string, createdAt: string, expiresAt: Date | null, source: "PRODUCED" | "EXISTING") =>
      testPrisma.productionItemBatch.create({
        data: {
          productionItemId: item.id,
          quantity,
          expiresAt,
          source,
          createdById: userId,
          createdAt: new Date(createdAt),
        },
      });
    const second = await batch("20", "2026-11-24T11:00:00Z", null, "EXISTING");
    const first = await batch("30.5", "2026-11-24T10:00:00Z", new Date("2027-02-01T00:00:00Z"), "PRODUCED");
    // Two extra weighings, the later one recorded first.
    const weighing = async (createdAt: string) => {
      const preWeighing = await testPrisma.preWeighing.create({
        data: { productSku: dough.sku, quantity: "5", createdById: userId },
      });
      await testPrisma.productionItemWeighing.create({
        data: { productionItemId: item.id, preWeighingId: preWeighing.id, createdAt: new Date(createdAt) },
      });
    };
    await weighing("2026-11-24T12:00:00Z");
    await weighing("2026-11-24T11:30:00Z");

    const presented = (await getProduction(headers, created.id)).json().items[0];

    expect(presented.batches).toEqual([
      {
        id: first.id,
        quantity: "30.5",
        expiresAt: "2027-02-01",
        source: "PRODUCED",
        createdAt: "2026-11-24T10:00:00.000Z",
      },
      { id: second.id, quantity: "20", expiresAt: null, source: "EXISTING", createdAt: "2026-11-24T11:00:00.000Z" },
    ]);
    expect(presented.extraWeighings).toBe(2);
    expect(presented.extraWeighedAt).toEqual(["2026-11-24T11:30:00.000Z", "2026-11-24T12:00:00.000Z"]);
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

describe("POST /v1/productions/:id/items/:itemId/conclude", () => {
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

    const response = await makeItem(headers, production.id, production.items[0].id, "46");

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

  it("writes a price for a manufactured product with a markup, on the cost of the lots on hand", async () => {
    const { headers, userId } = await canDoBoth();
    const { dough, production } = await startDough(headers);
    await testPrisma.productMarkup.create({
      data: { productSku: dough.sku, markupPercent: "50", updatedById: userId },
    });

    const response = await makeItem(headers, production.id, production.items[0].id, "46");

    expect(response.statusCode).toBe(200);

    const prices = await testPrisma.productPrice.findMany({ where: { productSku: dough.sku } });

    expect(prices).toHaveLength(1);
    expect(prices[0]?.averageCost.toString()).toBe("1.5");
    expect(prices[0]?.markupPercent.toString()).toBe("50");
    expect(prices[0]?.price.toString()).toBe("2.25");
  });

  it("writes no price for a product without a markup", async () => {
    const { headers } = await canDoBoth();
    const { dough, production } = await startDough(headers);

    await makeItem(headers, production.id, production.items[0].id, "46");

    expect(await testPrisma.productPrice.count({ where: { productSku: dough.sku } })).toBe(0);
  });

  it("writes off what was weighed when a pre-weighing guided the item", async () => {
    const { headers, userId } = await canDoBoth();
    const { flour, water, preWeighing } = await createDoughPreWeighing(userId);
    await stock(flour.sku, "100", "2");
    await stock(water.sku, "50", "0.5");
    const production = (await postProduction(headers, { preWeighingId: preWeighing.id })).json();

    const response = await makeItem(headers, production.id, production.items[0].id, "50");

    expect(response.statusCode).toBe(200);
    expect(await stockOf(flour.sku)).toEqual({ quantity: "69.75", averageCost: "2" });
    expect(await stockOf(water.sku)).toEqual({ quantity: "32.1", averageCost: "0.5" });
  });

  it("concludes each item of a production with several recipes", async () => {
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

    expect((await makeItem(headers, production.id, syrupItem.id, "4.5")).statusCode).toBe(200);
    const response = await makeItem(headers, production.id, doughItem.id, "48");

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

    const response = await makeItem(headers, production.id, production.items[0].id, "50");

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
      makeItem(headers, production.id, production.items[0]!.id, produced);

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

  describe("bringing the batches in as lots", () => {
    const lotsOf = async (productSku: string) =>
      (await testPrisma.stockLot.findMany({ where: { productSku }, orderBy: [{ expiresAt: "asc" }] })).map((found) => ({
        supplierId: found.supplierId,
        expiresAt: found.expiresAt?.toISOString().slice(0, 10) ?? null,
        initialQuantity: found.initialQuantity.toString(),
        quantity: found.quantity.toString(),
        unitCost: found.unitCost.toString(),
      }));

    it("opens a lot of what was produced, with its expiry date and what it cost", async () => {
      const { headers } = await canDoBoth();
      const { dough, production } = await startDough(headers);

      const response = await makeItem(headers, production.id, production.items[0].id, "46", {
        expiresAt: daysFromToday(3),
      });

      expect(response.statusCode).toBe(200);
      expect(await lotsOf(dough.sku)).toEqual([
        { supplierId: null, expiresAt: daysFromToday(3), initialQuantity: "46", quantity: "46", unitCost: "1.5" },
      ]);
      const produced = await testPrisma.stockLot.findFirstOrThrow({ where: { productSku: dough.sku } });
      expect((await testPrisma.stockMovement.findFirstOrThrow({ where: { type: "PRODUCTION_OUTPUT" } })).lotId).toBe(
        produced.id,
      );
    });

    it("refuses a batch whose expiry has passed, and moves nothing", async () => {
      const { headers, userId } = await canDoBoth();
      const { production } = await startDough(headers);
      const itemId = production.items[0].id;
      // Recorded yesterday to expire yesterday: a batch is never recorded already expired.
      await postBatch(headers, production.id, itemId, { quantity: "46", expiresAt: null, source: "PRODUCED" });
      await testPrisma.productionItemBatch.create({
        data: {
          productionItemId: itemId,
          quantity: "4",
          expiresAt: new Date(daysFromToday(-1)),
          source: "PRODUCED",
          createdById: userId,
        },
      });

      const response = await postConclude(headers, production.id, itemId);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "A batch's expiry has passed." });
      expect(await testPrisma.stockMovement.count()).toBe(0);
      expect((await getProduction(headers, production.id)).json().items[0]).toMatchObject({ status: "PENDING" });
    });

    it("opens a lot that never expires when the batches do not", async () => {
      const { headers } = await canDoBoth();
      const { dough, production } = await startDough(headers);

      await makeItem(headers, production.id, production.items[0].id, "46", { expiresAt: null });

      expect((await testPrisma.stockLot.findFirstOrThrow({ where: { productSku: dough.sku } })).expiresAt).toBeNull();
    });

    it("opens one lot per expiry, summing the batches of each, all at the real cost", async () => {
      const { headers } = await canDoBoth();
      const { dough, production } = await startDough(headers);
      const itemId = production.items[0].id;
      await postBatch(headers, production.id, itemId, {
        quantity: "20",
        expiresAt: daysFromToday(3),
        source: "PRODUCED",
      });
      await postBatch(headers, production.id, itemId, {
        quantity: "20",
        expiresAt: daysFromToday(5),
        source: "PRODUCED",
      });
      await postBatch(headers, production.id, itemId, {
        quantity: "10",
        expiresAt: daysFromToday(3),
        source: "PRODUCED",
      });

      const response = await postConclude(headers, production.id, itemId);

      // 69.00 of inputs for 50 kg made.
      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toMatchObject({ status: "FINISHED", producedQuantity: "50", unitCost: "1.38" });
      expect(await lotsOf(dough.sku)).toEqual([
        { supplierId: null, expiresAt: daysFromToday(3), initialQuantity: "30", quantity: "30", unitCost: "1.38" },
        { supplierId: null, expiresAt: daysFromToday(5), initialQuantity: "20", quantity: "20", unitCost: "1.38" },
      ]);
      expect(await testPrisma.stockMovement.count({ where: { type: "PRODUCTION_OUTPUT" } })).toBe(2);
      expect(await stockOf(dough.sku)).toEqual({ quantity: "50", averageCost: "1.38" });
    });

    it("takes half of every input for 25 made and 25 that already existed of 50, the existing at the average cost", async () => {
      const { headers } = await canDoBoth();
      const { dough, flour, water, production } = await startDough(headers);
      await stock(dough.sku, "10", "3");
      const itemId = production.items[0].id;
      await postBatch(headers, production.id, itemId, { quantity: "25", expiresAt: null, source: "PRODUCED" });
      await postBatch(headers, production.id, itemId, {
        quantity: "25",
        expiresAt: daysFromToday(10),
        source: "EXISTING",
      });

      const response = await postConclude(headers, production.id, itemId);

      // 15 kg of flour at 2 and 9 L of water at 0.5 are 34.50, for the 25 kg made.
      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toMatchObject({ producedQuantity: "50", unitCost: "1.38" });
      expect(await stockOf(flour.sku)).toMatchObject({ quantity: "85" });
      expect(await stockOf(water.sku)).toMatchObject({ quantity: "41" });
      // 10 kg at 3 already in stock, the 25 that existed at that average and the 25 made at 1.38.
      expect(await stockOf(dough.sku)).toEqual({ quantity: "60", averageCost: "2.325" });
      expect(
        (await lotsOf(dough.sku))
          .filter(({ initialQuantity }) => initialQuantity === "25")
          .map(({ expiresAt, unitCost }) => ({ expiresAt, unitCost })),
      ).toEqual([
        { expiresAt: daysFromToday(10), unitCost: "3" },
        { expiresAt: null, unitCost: "1.38" },
      ]);
    });

    it("takes nothing below the target when nothing was made now: 20 that already existed of 50", async () => {
      const { headers } = await canDoBoth();
      const { dough, flour, water, production } = await startDough(headers);
      await stock(dough.sku, "10", "3");
      const itemId = production.items[0].id;
      await postBatch(headers, production.id, itemId, { quantity: "20", expiresAt: null, source: "EXISTING" });

      const response = await postConclude(headers, production.id, itemId, { belowTarget: true });

      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toMatchObject({ status: "FINISHED", producedQuantity: "20", unitCost: "3" });
      expect(await stockOf(flour.sku)).toMatchObject({ quantity: "100" });
      expect(await stockOf(water.sku)).toMatchObject({ quantity: "50" });
      expect(await testPrisma.stockMovement.count({ where: { type: "PRODUCTION_CONSUMPTION" } })).toBe(0);
      expect(await stockOf(dough.sku)).toEqual({ quantity: "30", averageCost: "3" });
    });

    it("takes nothing when every batch already existed, and brings them in at no cost when the product has none", async () => {
      const { headers } = await canDoBoth();
      const { dough, flour, production } = await startDough(headers);
      const itemId = production.items[0].id;
      await postBatch(headers, production.id, itemId, { quantity: "50", expiresAt: null, source: "EXISTING" });

      const response = await postConclude(headers, production.id, itemId);

      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toMatchObject({ status: "FINISHED", producedQuantity: "50", unitCost: "0" });
      expect(await stockOf(flour.sku)).toMatchObject({ quantity: "100" });
      expect(await testPrisma.stockMovement.count({ where: { type: "PRODUCTION_CONSUMPTION" } })).toBe(0);
      expect(await lotsOf(dough.sku)).toEqual([
        { supplierId: null, expiresAt: null, initialQuantity: "50", quantity: "50", unitCost: "0" },
      ]);
    });
  });

  it("writes no price when every batch already existed and the product has no known cost", async () => {
    const { headers, userId } = await canDoBoth();
    const { dough, production } = await startDough(headers);
    await testPrisma.productMarkup.create({
      data: { productSku: dough.sku, markupPercent: "50", updatedById: userId },
    });
    const itemId = production.items[0].id;
    await postBatch(headers, production.id, itemId, { quantity: "50", expiresAt: null, source: "EXISTING" });

    const response = await postConclude(headers, production.id, itemId);

    expect(response.statusCode).toBe(200);
    expect(await testPrisma.productPrice.count({ where: { productSku: dough.sku } })).toBe(0);
  });

  it("weights what it produced into the average cost of the product already in stock", async () => {
    const { headers } = await canDoBoth();
    const { dough, production } = await startDough(headers);
    await stock(dough.sku, "46", "3");

    await makeItem(headers, production.id, production.items[0].id, "46");

    expect(await stockOf(dough.sku)).toEqual({ quantity: "92", averageCost: "2.25" });
  });

  it("answers 409 for an item already concluded, and moves the stock only once", async () => {
    const { headers } = await canDoBoth();
    const { flour, production } = await startDough(headers);
    await makeItem(headers, production.id, production.items[0].id, "46");

    const response = await postConclude(headers, production.id, production.items[0].id, { belowTarget: true });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "Production is not in progress." });
    expect(await stockOf(flour.sku)).toMatchObject({ quantity: "70" });
    expect(await testPrisma.stockMovement.count()).toBe(3);
  });

  it("concludes only the item asked for, and closes the production with the last one", async () => {
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

    const first = await makeItem(headers, production.id, doughItem.id, "48", { hasLeftoversInCost: false });

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

    const again = await postConclude(headers, production.id, doughItem.id, { belowTarget: true });

    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ message: "The item is not pending." });

    const last = await makeItem(headers, production.id, syrupItem.id, "4.5");

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

  it("refuses an item with no batch, and moves nothing", async () => {
    const { headers } = await canDoBoth();
    const { production } = await startDough(headers);

    const response = await postConclude(headers, production.id, production.items[0].id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The item has no batch." });
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it("refuses an item below its target unless told it is meant, and moves nothing", async () => {
    const { headers } = await canDoBoth();
    const { production } = await startDough(headers);
    const itemId = production.items[0].id;
    await postBatch(headers, production.id, itemId, { quantity: "46", expiresAt: null, source: "PRODUCED" });

    const response = await postConclude(headers, production.id, itemId);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The item is below its target." });
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect((await postConclude(headers, production.id, itemId, { belowTarget: true })).statusCode).toBe(200);
  });

  it("answers 409 when the cost of a produced unit does not fit, and undoes what it had moved", async () => {
    const { headers } = await canDoBoth();
    const { dough, flour } = await createDough();
    await stock(flour.sku, "100", "900000000000");
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();

    const response = await makeItem(headers, production.id, production.items[0].id, "0.001");

    expect(response.statusCode).toBe(409);
    expect(await stockOf(flour.sku)).toMatchObject({ quantity: "100" });
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect((await getProduction(headers, production.id)).json()).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("lets a batch sent together with the conclusion in only before it", async () => {
    const { headers } = await canDoBoth();
    const { dough } = await createDough();
    const { syrup } = await createSyrup();
    // The syrup keeps the production in progress once the dough is concluded.
    const production = (
      await postProduction(headers, {
        items: [
          { productSku: dough.sku, quantity: "50" },
          { productSku: syrup.sku, quantity: "5" },
        ],
      })
    ).json();
    const itemId = production.items[0].id;
    await postBatch(headers, production.id, itemId, { quantity: "50", expiresAt: null, source: "PRODUCED" });

    const [concluded, batch] = await Promise.all([
      postConclude(headers, production.id, itemId),
      postBatch(headers, production.id, itemId, { quantity: "10", expiresAt: null, source: "PRODUCED" }),
    ]);

    // Both hold the production: a batch after the conclusion finds the item no longer pending, and
    // one before it is concluded with the rest.
    expect(concluded.statusCode).toBe(200);
    const doughItem = (await getProduction(headers, production.id)).json().items[0];
    if (batch.statusCode === 201) {
      expect(doughItem.producedQuantity).toBe("60");
    } else {
      expect(batch.statusCode).toBe(409);
      expect(batch.json()).toEqual({ message: "The item is not pending." });
      expect(doughItem.producedQuantity).toBe("50");
    }
    expect(await testPrisma.productionItemBatch.count()).toBe(batch.statusCode === 201 ? 2 : 1);
  });

  it("answers 404 for an item not of the production, or a production that does not exist", async () => {
    const { headers } = await canDoBoth();
    const { production } = await startDough(headers);

    const missingItem = await postConclude(headers, production.id, MISSING_ID);
    const missingProduction = await postConclude(headers, MISSING_ID, production.items[0].id);

    expect(missingItem.statusCode).toBe(404);
    expect(missingItem.json()).toEqual({ message: "Production item not found." });
    expect(missingProduction.statusCode).toBe(404);
  });

  it("answers 400 for a body that does not say yes or no", async () => {
    const { headers } = await canDoBoth();
    const { production } = await startDough(headers);

    const response = await postConclude(headers, production.id, production.items[0].id, { belowTarget: "yes" });

    expect(response.statusCode).toBe(400);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await postConclude(headers, MISSING_ID, MISSING_ID)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postConclude(undefined, MISSING_ID, MISSING_ID)).statusCode).toBe(401);
  });

  it("no longer offers the finish of a production nor the reduction of an item", async () => {
    const paths = (await collectRoutes()).map(({ path }) => path);

    expect(paths).toContain("/v1/productions/{id}/items/{itemId}/conclude");
    expect(paths).not.toContain("/v1/productions/{id}/finish");
    expect(paths).not.toContain("/v1/productions/{id}/items/{itemId}/reduce");
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

  // Each item made and concluded in turn, in the order given: the first refusal, or the last answer.
  async function concludeItems(headers: Headers, productionId: string, items: [{ id: string }, string][]) {
    let response;

    for (const [item, quantity] of items) {
      response = await makeItem(headers, productionId, item.id, quantity);

      if (response.statusCode !== 200) return response;
    }

    return response!;
  }

  const concludeAs = (headers: Headers, production: { id: string; items: { id: string }[] }, produced: string[]) =>
    concludeItems(
      headers,
      production.id,
      production.items.map((item, index) => [item, produced[index]!]),
    );

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

  it("concludes the filling and then the shells, each discarding what its opened can leaves, and stays in progress", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId, { chocolateInCans: true });
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);

    const response = await concludeItems(headers, id, [
      [fillingItem, "0.7"],
      [shellItem, "50"],
    ]);

    // The filling opens a can for 0.14 kg and leaves 0.86 kg of it: (0.56 × 2 + 0.14 × 10 + 0.86 × 10)
    // ÷ 0.7. The shells open the next for 0.5 kg and leave 0.5 kg: (0.5 × 10 + 0.5 × 10) ÷ 50.
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
          unitCost: "15.885714",
        },
        {
          id: shellItem.id,
          status: "FINISHED",
          finishedAt: expect.any(String),
          hasLeftoversInCost: true,
          unitCost: "0.2",
        },
      ],
    });
    const leftovers = await testPrisma.productionLeftover.findMany({ orderBy: { quantity: "asc" } });
    expect(leftovers.map(({ quantity }) => quantity.toString())).toEqual(["0.5", "0.86"]);
    expect(await stockOf(tree.chocolate.sku)).toMatchObject({ quantity: "8" });
    expect(await stockOf(tree.bonbon.sku)).toBeNull();
  });

  it("refuses the bombom while the shells are pending, naming them, and moves nothing", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
    await concludeItems(headers, id, [[fillingItem, "0.7"]]);
    const movements = await testPrisma.stockMovement.count();

    const response = await concludeItems(headers, id, [[bonbonItem, "50"]]);

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

  it("refuses to conclude the bombom while what it waits for is pending, naming both", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);

    const response = await postConclude(headers, id, bonbonItem.id, { belowTarget: true });

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
      await concludeItems(headers, id, [
        [fillingItem, "0.7"],
        [shellItem, "50"],
      ])
    ).json();

    const response = await concludeItems(headers, id, [[bonbonItem, "50"]]);

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
    await concludeItems(headers, id, [[fillingItem, "0.7"]]);
    const fillingStock = await stockOf(tree.filling.sku);

    const response = await postCancel(headers, id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "CANCELED", canceledAt: expect.any(String) });
    expect(await stockOf(tree.filling.sku)).toEqual(fillingStock);
    expect((await getPreWeighing(headers, tree.fillingStage.id)).json()).toMatchObject({ status: "PRODUCED" });
    expect((await getPreWeighing(headers, tree.root.id)).json()).toMatchObject({ status: "PENDING" });
    expect((await getPreWeighing(headers, tree.shellStage.id)).json()).toMatchObject({ status: "PENDING" });
  });

  it("cancels concluding each item with batches with what it made, and releases the pre-weighings of the others", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
    // Below its target, the bombom short of it, and a batch recorded yesterday that expired today:
    // a cancel concludes it anyway, as it happened at the bench.
    await postBatch(headers, id, fillingItem.id, { quantity: "0.5", expiresAt: null, source: "PRODUCED" });
    await testPrisma.productionItemBatch.create({
      data: {
        productionItemId: fillingItem.id,
        quantity: "0.1",
        expiresAt: new Date(daysFromToday(-1)),
        source: "PRODUCED",
        createdById: userId,
      },
    });

    const response = await postCancel(headers, id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "CANCELED",
      canceledAt: expect.any(String),
      finishedAt: null,
      items: [
        { id: bonbonItem.id, status: "PENDING", preWeighingId: null },
        {
          id: fillingItem.id,
          status: "FINISHED",
          producedQuantity: "0.6",
          hasLeftoversInCost: true,
          preWeighingId: tree.fillingStage.id,
        },
        { id: shellItem.id, status: "PENDING", preWeighingId: null },
      ],
    });
    expect(await stockOf(tree.filling.sku)).toMatchObject({ quantity: "0.9" });
    expect(await stockOf(tree.milk.sku)).toMatchObject({ quantity: "9.44" });
    expect(await testPrisma.stockLot.count({ where: { productSku: tree.filling.sku } })).toBe(3);
    expect((await getPreWeighing(headers, tree.fillingStage.id)).json()).toMatchObject({ status: "PRODUCED" });
    expect((await getPreWeighing(headers, tree.root.id)).json()).toMatchObject({ status: "PENDING" });
    expect((await getPreWeighing(headers, tree.shellStage.id)).json()).toMatchObject({ status: "PENDING" });
  });

  it("cancels concluding the filling before the bombom that takes it, which takes the lot it made", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
    await postBatch(headers, id, fillingItem.id, { quantity: "0.7", expiresAt: null, source: "PRODUCED" });
    await postBatch(headers, id, shellItem.id, { quantity: "50", expiresAt: null, source: "PRODUCED" });
    // The bombom was made at the bench while its intermediates were still open on the screen.
    await testPrisma.productionItemBatch.create({
      data: { productionItemId: bonbonItem.id, quantity: "50", source: "PRODUCED", createdById: userId },
    });

    const response = await postCancel(headers, id);

    // The filling: 0.56 kg of milk at 2 and 0.14 of chocolate at 10 for 0.7 kg, 3.6 a kg; the shells:
    // 0.5 kg of chocolate for 50, 0.1 each. The bombom takes the 0.3 kg of filling at 1 and the 0.7 made
    // at 3.6, the 50 shells and 0.25 kg of sprinkles at 4: (0.3 + 2.52 + 5 + 1) ÷ 50.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "CANCELED",
      items: [
        { id: bonbonItem.id, status: "FINISHED", producedQuantity: "50", unitCost: "0.1764" },
        { id: fillingItem.id, status: "FINISHED", producedQuantity: "0.7", unitCost: "3.6" },
        { id: shellItem.id, status: "FINISHED", producedQuantity: "50", unitCost: "0.1" },
      ],
    });
    expect(await stockOf(tree.filling.sku)).toMatchObject({ quantity: "0" });
    expect(await stockOf(tree.shell.sku)).toMatchObject({ quantity: "0" });
    expect(await stockOf(tree.milk.sku)).toMatchObject({ quantity: "9.44" });
    expect(await stockOf(tree.chocolate.sku)).toMatchObject({ quantity: "9.36" });
    expect(await stockOf(tree.sprinkles.sku)).toMatchObject({ quantity: "9.75" });
    expect(await stockOf(tree.bonbon.sku)).toEqual({ quantity: "50", averageCost: "0.1764" });
  });

  it("refuses an item already finished, and moves nothing", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, fillingItem } = await startTree(headers, tree);
    await concludeItems(headers, id, [[fillingItem, "0.7"]]);
    const movements = await testPrisma.stockMovement.count();

    const response = await concludeItems(headers, id, [[fillingItem, "0.7"]]);

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

    const response = await concludeItems(headers, id, [[fillingItem, "0.7"]]);

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

      const finish = await concludeItems(headers, id, [[fillingItem, "0.7"]]);
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

      const finished = await makeItem(headers, started.id, itemId, "50");

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
      await concludeItems(headers, id, [[fillingItem, "0.7"]]);
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
      await concludeItems(headers, id, [[fillingItem, "0.7"]]);
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

    it("lets only one of a batch and a damage of the same item sent together through", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const reason = await burnt();

      const [batch, damage] = await Promise.all([
        postBatch(headers, id, fillingItem.id, { quantity: "0.7", expiresAt: null, source: "PRODUCED" }),
        postDamage(headers, id, fillingItem.id, { reasonId: reason.id }),
      ]);

      // Both hold the production, so one runs after the other and sees what it wrote: a damage after
      // the batch finds the item with a batch, a batch after the damage finds it waiting for a weighing.
      expect([batch.statusCode, damage.statusCode].sort()).toEqual([201, 409]);
      if (batch.statusCode === 201) {
        expect(damage.json()).toEqual({ message: "The item already has batches." });
        expect(await testPrisma.productionItemDamage.count()).toBe(0);
      } else {
        expect(batch.json()).toEqual({ message: "The item waits for a new weighing." });
        expect(await testPrisma.productionItemBatch.count()).toBe(0);
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

  describe("weighing an item and adding one for a shortage", () => {
    const burnt = () => testPrisma.lossReason.create({ data: { name: "Queimou" } });

    type Tree = Awaited<ReturnType<typeof bonbonTree>>;

    // A filling weighed: condensed milk and chocolate, both weighed.
    const fillingWeighing = (tree: Tree, quantity: string, milk: string, chocolate: string) => ({
      quantity,
      items: [
        { productSku: tree.milk.sku, weighedQuantity: milk },
        { productSku: tree.chocolate.sku, weighedQuantity: chocolate },
      ],
    });

    const newPreWeighingOf = (productSku: string, except: string[]) =>
      testPrisma.preWeighing.findFirstOrThrow({ where: { productSku, id: { notIn: except } } });

    const quantitiesOf = (item: { inputs: { quantity: string }[] }) => item.inputs.map(({ quantity }) => quantity);

    type PresentedItem = { id: string; inputs: { quantity: string }[]; [field: string]: unknown };

    const itemIn = (production: { items: PresentedItem[] }, id: string) =>
      production.items.find((item) => item.id === id)!;

    it("records an extra weighing of the filling under the root, and sums its lines into the inputs", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);

      const response = await postItemWeighing(
        headers,
        id,
        fillingItem.id,
        fillingWeighing(tree, "0.3", "0.24", "0.06"),
      );

      expect(response.statusCode).toBe(200);
      const weighed = await newPreWeighingOf(tree.filling.sku, [tree.fillingStage.id]);
      expect(weighed.parentId).toBe(tree.root.id);
      expect(await testPrisma.productionItemWeighing.findMany()).toEqual([
        expect.objectContaining({ productionItemId: fillingItem.id, preWeighingId: weighed.id }),
      ]);
      const filling = itemIn(response.json(), fillingItem.id);
      expect(filling).toMatchObject({
        preWeighingId: tree.fillingStage.id,
        expectedQuantity: "0.7",
        extraWeighings: 1,
        awaitsWeighing: false,
      });
      // Chocolate, then condensed milk: 0.14 + 0.06 and 0.56 + 0.24.
      expect(quantitiesOf(filling)).toEqual(["0.2", "0.8"]);
      expect((await getPreWeighing(headers, weighed.id)).json()).toMatchObject({ status: "IN_PRODUCTION" });
    });

    it("lets go of an extra weighing of an item canceled without a batch: it is pending and can be deleted", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      await postItemWeighing(headers, id, fillingItem.id, fillingWeighing(tree, "0.3", "0.24", "0.06"));
      const weighed = await newPreWeighingOf(tree.filling.sku, [tree.fillingStage.id]);

      const response = await postCancel(headers, id);

      expect(response.statusCode).toBe(200);
      expect(itemIn(response.json(), fillingItem.id)).toMatchObject({ status: "PENDING", extraWeighings: 0 });
      expect((await getPreWeighing(headers, weighed.id)).json()).toMatchObject({ status: "PENDING" });
      expect((await deletePreWeighing(headers, weighed.id)).statusCode).toBe(204);
    });

    it("concludes the bombom below its target taking of its intermediates only what was made of all it was weighed for", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
      await concludeItems(headers, id, [
        [fillingItem, "0.7"],
        [shellItem, "50"],
      ]);
      const weighing = await postItemWeighing(headers, id, bonbonItem.id, {
        quantity: "10",
        items: [
          { productSku: tree.filling.sku },
          { productSku: tree.shell.sku },
          { productSku: tree.sprinkles.sku, weighedQuantity: "0.05" },
        ],
      });
      await postBatch(headers, id, bonbonItem.id, { quantity: "45", expiresAt: null, source: "PRODUCED" });

      const response = await postConclude(headers, id, bonbonItem.id, { belowTarget: true });

      // Weighed for 60: 1.2 kg of filling and 60 shells; the 45 made take 0.9 kg and 45 shells, the
      // 0.3 kg of sprinkles weighed whole.
      expect(weighing.statusCode).toBe(200);
      expect(response.statusCode).toBe(200);
      expect(itemIn(response.json(), bonbonItem.id)).toMatchObject({ status: "FINISHED", producedQuantity: "45" });
      expect(await stockOf(tree.filling.sku)).toMatchObject({ quantity: "0.1" });
      expect(await stockOf(tree.shell.sku)).toMatchObject({ quantity: "5" });
      expect(await stockOf(tree.sprinkles.sku)).toMatchObject({ quantity: "9.7" });
    });

    it("re-guides the damaged filling with the new weighing, recorded where the damaged one was", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      await postDamage(headers, id, fillingItem.id, { reasonId: (await burnt()).id });

      const response = await postItemWeighing(headers, id, fillingItem.id, fillingWeighing(tree, "0.5", "0.4", "0.1"));

      expect(response.statusCode).toBe(200);
      const weighed = await newPreWeighingOf(tree.filling.sku, [tree.fillingStage.id]);
      expect(weighed.parentId).toBe(tree.root.id);
      const filling = itemIn(response.json(), fillingItem.id);
      expect(filling).toMatchObject({
        status: "PENDING",
        preWeighingId: weighed.id,
        awaitsWeighing: false,
        expectedQuantity: "0.5",
        extraWeighings: 0,
        weighedAt: weighed.createdAt.toISOString(),
        damages: [{ preWeighingId: tree.fillingStage.id }],
      });
      expect(quantitiesOf(filling)).toEqual(["0.1", "0.4"]);
      expect(await testPrisma.productionItemWeighing.count()).toBe(0);
      expect((await getPreWeighing(headers, tree.fillingStage.id)).json()).toMatchObject({ status: "DAMAGED" });
      expect((await getPreWeighing(headers, weighed.id)).json()).toMatchObject({ status: "IN_PRODUCTION" });
    });

    it("adds a filling for a shortage that awaits a weighing, refuses a batch until it is weighed, then takes one", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem } = await startTree(headers, tree);

      const added = await postItem(headers, id, { productSku: tree.filling.sku, quantity: "0.3" });

      expect(added.statusCode).toBe(201);
      const fillings = added
        .json()
        .items.filter((item: { product: { sku: string } }) => item.product.sku === tree.filling.sku);
      expect(fillings).toHaveLength(2);
      const shortage = fillings.find((item: { preWeighingId: string | null }) => item.preWeighingId === null);
      expect(shortage).toMatchObject({
        status: "PENDING",
        expectedQuantity: "0.3",
        awaitsWeighing: true,
        inputs: [],
        batches: [],
        damages: [],
      });
      expect(itemIn(added.json(), bonbonItem.id).dependsOn).toEqual(expect.arrayContaining([shortage.id]));

      const refused = await postBatch(headers, id, shortage.id, {
        quantity: "0.3",
        source: "PRODUCED",
        expiresAt: null,
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().message).toBe("The item waits for a new weighing.");

      const weighing = await postItemWeighing(headers, id, shortage.id, fillingWeighing(tree, "0.3", "0.24", "0.06"));

      expect(weighing.statusCode).toBe(200);
      const weighed = await newPreWeighingOf(tree.filling.sku, [tree.fillingStage.id]);
      expect(weighed.parentId).toBeNull();
      const guided = itemIn(weighing.json(), shortage.id);
      expect(guided).toMatchObject({ preWeighingId: weighed.id, awaitsWeighing: false, expectedQuantity: "0.3" });
      expect(quantitiesOf(guided)).toEqual(["0.06", "0.24"]);

      const accepted = await postBatch(headers, id, shortage.id, {
        quantity: "0.3",
        source: "PRODUCED",
        expiresAt: null,
      });
      expect(accepted.statusCode).toBe(201);
    });

    it("refuses to add a product no item of the production takes", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id } = await startTree(headers, tree);
      const before = await testPrisma.productionItem.count();

      const notTaken = await postItem(headers, id, { productSku: tree.bonbon.sku, quantity: "10" });
      const missing = await postItem(headers, id, { productSku: MISSING_ID, quantity: "1" });

      for (const response of [notTaken, missing]) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ message: "Only an intermediate of the production can be added." });
      }
      expect(await testPrisma.productionItem.count()).toBe(before);
    });

    it("refuses to add a bought ingredient, or an intermediate only finished items take", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem } = await startTree(headers, tree);
      const before = await testPrisma.productionItem.count();

      const bought = await postItem(headers, id, { productSku: tree.milk.sku, quantity: "0.3" });
      // Only the bombom takes the shells; once it is finished, no pending item lacks them.
      await testPrisma.productionItem.update({ where: { id: bonbonItem.id }, data: { status: "FINISHED" } });
      const takenByFinished = await postItem(headers, id, { productSku: tree.shell.sku, quantity: "10" });

      for (const response of [bought, takenByFinished]) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ message: "Only an intermediate of the production can be added." });
      }
      expect(await testPrisma.productionItem.count()).toBe(before);
    });

    it("refuses to add more decimal places than the product's unit allows", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id } = await startTree(headers, tree);

      const response = await postItem(headers, id, { productSku: tree.shell.sku, quantity: "2.5" });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The quantity has more decimal places than the unit allows." });
    });

    it("answers 404 and 409 for adding to a production missing or not in progress, and checks the body and permission", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id } = await startTree(headers, tree);
      const readOnly = await authenticateAs([Permission.PRODUCTION_READ], "reader");
      const body = { productSku: tree.filling.sku, quantity: "0.3" };

      expect((await postItem(headers, id, { productSku: tree.filling.sku, quantity: "0" })).statusCode).toBe(400);
      expect((await postItem(headers, id, { quantity: "1" })).statusCode).toBe(400);
      expect((await postItem(readOnly.headers, id, body)).statusCode).toBe(403);
      expect((await postItem(headers, MISSING_ID, body)).statusCode).toBe(404);
      await postCancel(headers, id);
      const canceled = await postItem(headers, id, body);
      expect(canceled.statusCode).toBe(409);
      expect(canceled.json()).toEqual({ message: "Production is not in progress." });
    });

    it("refuses a weighing that does not match the recipe, and writes nothing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const before = await testPrisma.preWeighing.count();

      const response = await postItemWeighing(headers, id, fillingItem.id, {
        quantity: "0.3",
        items: [{ productSku: tree.milk.sku, weighedQuantity: "0.24" }],
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ message: "The items do not match the ingredients of the recipe." });
      expect(await testPrisma.preWeighing.count()).toBe(before);
      expect(await testPrisma.productionItemWeighing.count()).toBe(0);
      const filling = itemIn((await getProduction(headers, id)).json(), fillingItem.id);
      expect(filling).toMatchObject({
        preWeighingId: tree.fillingStage.id,
        expectedQuantity: "0.7",
        extraWeighings: 0,
      });
      expect(quantitiesOf(filling)).toEqual(["0.14", "0.56"]);
    });

    it("refuses to weigh an item that is not pending or waits for another item, and records nothing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem } = await startTree(headers, tree);
      await concludeItems(headers, id, [[fillingItem, "0.7"]]);
      const before = await testPrisma.preWeighing.count();

      const finished = await postItemWeighing(
        headers,
        id,
        fillingItem.id,
        fillingWeighing(tree, "0.3", "0.24", "0.06"),
      );
      const waiting = await postItemWeighing(headers, id, bonbonItem.id, {
        quantity: "10",
        items: [
          { productSku: tree.filling.sku },
          { productSku: tree.shell.sku },
          { productSku: tree.sprinkles.sku, weighedQuantity: "0.05" },
        ],
      });

      expect(finished.statusCode).toBe(409);
      expect(finished.json().message).toBe("The item is not pending.");
      expect(waiting.statusCode).toBe(409);
      expect(waiting.json().message).toBe("An item waits for another item of the production.");
      expect(await testPrisma.preWeighing.count()).toBe(before);
    });

    it("answers 404 for an item or a production missing, and 409 for one not in progress", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const body = fillingWeighing(tree, "0.3", "0.24", "0.06");

      const noItem = await postItemWeighing(headers, id, MISSING_ID, body);
      const noProduction = await postItemWeighing(headers, MISSING_ID, fillingItem.id, body);
      await postCancel(headers, id);
      const before = await testPrisma.preWeighing.count();
      const canceled = await postItemWeighing(headers, id, fillingItem.id, body);

      expect([noItem.statusCode, noProduction.statusCode, canceled.statusCode]).toEqual([404, 404, 409]);
      expect(noItem.json().message).toBe("Production item not found.");
      expect(noProduction.json().message).toBe("Production not found.");
      expect(canceled.json().message).toBe("Production is not in progress.");
      expect(await testPrisma.preWeighing.count()).toBe(before);
    });

    it("validates the weighing body and the permission", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const readOnly = await authenticateAs([Permission.PRODUCTION_READ], "reader");
      const body = fillingWeighing(tree, "0.3", "0.24", "0.06");

      expect((await postItemWeighing(headers, id, fillingItem.id, { ...body, items: [] })).statusCode).toBe(400);
      expect((await postItemWeighing(headers, id, fillingItem.id, { ...body, quantity: "0" })).statusCode).toBe(400);
      expect((await postItemWeighing(readOnly.headers, id, fillingItem.id, body)).statusCode).toBe(403);
      expect((await postItemWeighing(undefined, id, fillingItem.id, body)).statusCode).toBe(401);
    });

    it("no longer offers the production-level weighing", async () => {
      const paths = (await collectRoutes()).map(({ path }) => path);

      expect(paths).toContain("/v1/productions/{id}/items/{itemId}/weighings");
      expect(paths).not.toContain("/v1/productions/{id}/weighings");
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

      await concludeItems(headers, id, [[fillingItem, "0.7"]]);
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

      await concludeItems(headers, id, [[fillingItem, "0.7"]]);
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
      const substitutedAt = items.find((item: { id: string }) => item.id === fillingItem.id).substitutedAt;
      expect(typeof substitutedAt).toBe("string");
      expect(Date.now() - new Date(substitutedAt).getTime()).toBeLessThan(60_000);
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
      await concludeItems(headers, id, [[shellItem, "50"]]);

      const response = await concludeItems(headers, id, [[bonbonItem, "50"]]);

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

    const response = await concludeAs(headers, bonbon, ["50"]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "FINISHED" });
    expect(await stockOf(filling.sku)).toMatchObject({ quantity: "0" });
  });

  it("answers a canceled intermediate with the shortage it leaves", async () => {
    const { headers, userId } = await canDoBoth();
    const { root, filling, fillingStage, shellStage } = await bonbonTree(userId);
    const fillingProduction = await startOneEach([fillingStage.id]);
    await postCancel(headers, fillingProduction.id);
    await concludeAs(headers, await startOneEach([shellStage.id]), ["50"]);
    const bonbon = await startOneEach([root.id]);
    const movements = await testPrisma.stockMovement.count();

    const response = await concludeAs(headers, bonbon, ["50"]);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      message: shortageMessage,
      shortages: [{ product: { sku: filling.sku }, needed: "1", available: "0.3" }],
    });
    expect(response.json()).not.toHaveProperty("pendingPreWeighings");
    expect(await testPrisma.stockMovement.count()).toBe(movements);
  });

  it("refuses the filling below its target when the bombom would lack it, naming what is missing, and moves nothing", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, fillingItem } = await startTree(headers, tree);
    await postBatch(headers, id, fillingItem.id, { quantity: "0.5", expiresAt: null, source: "PRODUCED" });

    const response = await postConclude(headers, id, fillingItem.id, { belowTarget: true });

    // The bombom takes 1 kg: 0.3 in stock and 0.5 made leave 0.2 missing.
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: "An intermediate would fall short.",
      missing: [{ product: { sku: tree.filling.sku, description: "Filling", unit: "KILOGRAM" }, quantity: "0.2" }],
    });
    expect(await testPrisma.stockMovement.count()).toBe(0);
    expect(await stockOf(tree.filling.sku)).toMatchObject({ quantity: "0.3" });
    expect((await getProduction(headers, id)).json().items[1]).toMatchObject({ id: fillingItem.id, status: "PENDING" });
  });

  it("concludes a filling below its target when another filling item still pending covers what the bombom takes", async () => {
    const { headers, userId } = await canDoBoth();
    const { bonbon, filling } = await bonbonTree(userId);
    // Two filling items of 0.7: the bombom's stage, and one asked for on its own.
    const production = (
      await postProduction(headers, {
        items: [
          { productSku: bonbon.sku, quantity: "50", produce: [{ productSku: filling.sku, quantity: "0.7" }] },
          { productSku: filling.sku, quantity: "0.7" },
        ],
      })
    ).json();
    const [first, second] = production.items.filter(
      (item: { product: { sku: string } }) => item.product.sku === filling.sku,
    );
    expect([first.expectedQuantity, second.expectedQuantity]).toEqual(["0.7", "0.7"]);
    await postBatch(headers, production.id, first.id, { quantity: "0.6", expiresAt: null, source: "PRODUCED" });

    const response = await postConclude(headers, production.id, first.id, { belowTarget: true });

    // The bombom takes 1 kg: 0.3 in stock, 0.6 made and the 0.7 the other filling is to make cover it.
    expect(response.statusCode).toBe(200);
    expect(await stockOf(filling.sku)).toMatchObject({ quantity: "0.9" });
  });

  it("concludes the filling below its target when the stock covers what the bombom takes", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    await testPrisma.productStock.update({ where: { productSku: tree.filling.sku }, data: { quantity: "0.5" } });
    await lot(tree.filling.sku, "0.2", "1");
    const { id, fillingItem } = await startTree(headers, tree);
    await postBatch(headers, id, fillingItem.id, { quantity: "0.5", expiresAt: null, source: "PRODUCED" });

    const refused = await postConclude(headers, id, fillingItem.id);
    const response = await postConclude(headers, id, fillingItem.id, { belowTarget: true });

    expect(refused.json()).toEqual({ message: "The item is below its target." });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[1]).toMatchObject({ status: "FINISHED", producedQuantity: "0.5" });
    expect(await stockOf(tree.filling.sku)).toMatchObject({ quantity: "1" });
  });

  it("concludes the bombom below its target taking of what it took unweighed only what was made", async () => {
    const { headers, userId } = await canDoBoth();
    const tree = await bonbonTree(userId);
    const { id, bonbonItem, fillingItem, shellItem } = await startTree(headers, tree);
    await concludeItems(headers, id, [
      [fillingItem, "0.7"],
      [shellItem, "50"],
    ]);

    const response = await makeItem(headers, id, bonbonItem.id, "40");

    // 40 of 50: 0.8 kg of filling (0.3 at 1 and 0.5 at 3.6) and 40 shells at 0.1 leave; the 0.25 kg
    // of sprinkles weighed leave whole, at 4: (0.3 + 1.8 + 4 + 1) ÷ 40.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "FINISHED",
      items: [{ id: bonbonItem.id, producedQuantity: "40", unitCost: "0.1775" }, {}, {}],
    });
    expect(await stockOf(tree.filling.sku)).toMatchObject({ quantity: "0.2" });
    expect(await stockOf(tree.shell.sku)).toMatchObject({ quantity: "10" });
    expect(await stockOf(tree.sprinkles.sku)).toMatchObject({ quantity: "9.75" });
    expect(await stockOf(tree.bonbon.sku)).toMatchObject({ quantity: "40" });
  });

  it("checks each bombom against what the stock has left when it is concluded", async () => {
    const { headers, userId } = await canDoBoth();
    const { bonbon, filling, shell } = await bonbonTree(userId);
    await stock(shell.sku, "50", "0.1");
    await testPrisma.productStock.update({ where: { productSku: filling.sku }, data: { quantity: "0.8" } });
    await lot(filling.sku, "0.5", "1");
    // The second is told to take its filling from stock too, which the first leaves short of it.
    const production = (
      await postProduction(headers, {
        items: [
          { productSku: bonbon.sku, quantity: "25" },
          { productSku: bonbon.sku, quantity: "25", produce: [{ productSku: filling.sku, quantity: "0" }] },
        ],
      })
    ).json();
    const [first, second] = production.items;

    expect((await makeItem(headers, production.id, first.id, "25")).statusCode).toBe(200);
    const movements = await testPrisma.stockMovement.count();
    const response = await makeItem(headers, production.id, second.id, "25");

    // The first took 0.5 of the 0.8: 0.3 make 15 of the 25.
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      message: shortageMessage,
      shortages: [{ itemId: second.id, product: { sku: filling.sku }, needed: "0.5", available: "0.3" }],
      items: [{ itemId: second.id, maxQuantity: "15" }],
    });
    expect(await testPrisma.stockMovement.count()).toBe(movements);
  });

  describe("recording and removing batches", () => {
    const batchOf = (quantity: string, source = "PRODUCED", expiresAt: string | null = null) => ({
      quantity,
      source,
      expiresAt,
    });
    const alreadyHasBatches = "The item already has batches.";

    it("records a produced and an existing batch on the filling, presented in order", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);

      const produced = await postBatch(headers, id, fillingItem.id, batchOf("0.4", "PRODUCED", "2099-03-04"));
      const existing = await postBatch(headers, id, fillingItem.id, batchOf("0.2", "EXISTING"));

      expect(produced.statusCode).toBe(201);
      expect(existing.statusCode).toBe(201);
      const filling = existing.json().items.find((item: { id: string }) => item.id === fillingItem.id);
      expect(filling.batches).toEqual([
        {
          id: expect.any(String),
          quantity: "0.4",
          expiresAt: "2099-03-04",
          source: "PRODUCED",
          createdAt: expect.any(String),
        },
        { id: expect.any(String), quantity: "0.2", expiresAt: null, source: "EXISTING", createdAt: expect.any(String) },
      ]);
      const stored = await testPrisma.productionItemBatch.findFirstOrThrow({ where: { source: "PRODUCED" } });
      expect(stored.expiresAt?.toISOString()).toBe("2099-03-04T00:00:00.000Z");
      expect(stored.createdById).toBe(userId);
      expect(filling.status).toBe("PENDING");
    });

    it("refuses a batch on the bombom while the filling is pending, naming what it waits for", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, bonbonItem, fillingItem } = await startTree(headers, tree);

      const response = await postBatch(headers, id, bonbonItem.id, batchOf("50"));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        message: "An item waits for another item of the production.",
        waitingFor: [
          {
            itemId: bonbonItem.id,
            waitsFor: expect.arrayContaining([{ itemId: fillingItem.id, product: expect.anything() }]),
          },
        ],
      });
    });

    it("refuses a batch on a finished item", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      await concludeItems(headers, id, [[fillingItem, "0.7"]]);

      const response = await postBatch(headers, id, fillingItem.id, batchOf("0.1"));

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toBe("The item is not pending.");
    });

    it("refuses a batch on an item that waits for a new weighing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const reason = await testPrisma.lossReason.create({ data: { name: "Queimou" } });
      await postDamage(headers, id, fillingItem.id, { reasonId: reason.id });

      const response = await postBatch(headers, id, fillingItem.id, batchOf("0.1"));

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toBe("The item waits for a new weighing.");
    });

    it("refuses more decimal places than the unit allows", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, shellItem } = await startTree(headers, tree);

      const response = await postBatch(headers, id, shellItem.id, batchOf("2.5"));

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toBe("The quantity has more decimal places than the unit allows.");
    });

    it("answers 404 for an item or a production that does not exist, and 409 for one not in progress", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);

      const noItem = await postBatch(headers, id, MISSING_ID, batchOf("1"));
      const noProduction = await postBatch(headers, MISSING_ID, fillingItem.id, batchOf("1"));
      await postCancel(headers, id);
      const canceled = await postBatch(headers, id, fillingItem.id, batchOf("1"));

      expect([noItem.statusCode, noProduction.statusCode, canceled.statusCode]).toEqual([404, 404, 409]);
      expect(noItem.json().message).toBe("Production item not found.");
      expect(canceled.json().message).toBe("Production is not in progress.");
    });

    it("validates the body and the permission", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const readOnly = await authenticateAs([Permission.PRODUCTION_READ], "reader");

      expect((await postBatch(headers, id, fillingItem.id, { source: "PRODUCED" })).statusCode).toBe(400);
      expect((await postBatch(headers, id, fillingItem.id, batchOf("0"))).statusCode).toBe(400);
      expect((await postBatch(headers, id, fillingItem.id, batchOf("1", "OTHER"))).statusCode).toBe(400);
      expect((await postBatch(headers, id, fillingItem.id, batchOf("1", "PRODUCED", "2001-01-01"))).statusCode).toBe(
        400,
      );
      expect((await postBatch(readOnly.headers, id, fillingItem.id, batchOf("1"))).statusCode).toBe(403);
      expect((await postBatch(undefined, id, fillingItem.id, batchOf("1"))).statusCode).toBe(401);
    });

    it("records a batch sent without an expiry as one that never expires", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);

      const response = await postBatch(headers, id, fillingItem.id, { quantity: "0.4", source: "PRODUCED" });

      expect(response.statusCode).toBe(201);
      expect(response.json().items.find((item: { id: string }) => item.id === fillingItem.id).batches).toMatchObject([
        { quantity: "0.4", expiresAt: null },
      ]);
    });

    it("removes a batch of a pending item", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const recorded = await postBatch(headers, id, fillingItem.id, batchOf("0.4"));
      const batchId = recorded.json().items.find((item: { id: string }) => item.id === fillingItem.id).batches[0].id;

      const response = await deleteBatch(headers, id, fillingItem.id, batchId);

      expect(response.statusCode).toBe(200);
      expect(response.json().items.find((item: { id: string }) => item.id === fillingItem.id).batches).toEqual([]);
      expect(await testPrisma.productionItemBatch.count()).toBe(0);
    });

    it("answers 404 when the batch is another item's, and refuses removal from a finished item", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem, shellItem } = await startTree(headers, tree);
      const recorded = await postBatch(headers, id, fillingItem.id, batchOf("0.7"));
      const batchId = recorded.json().items.find((item: { id: string }) => item.id === fillingItem.id).batches[0].id;

      const other = await deleteBatch(headers, id, shellItem.id, batchId);
      const missing = await deleteBatch(headers, id, fillingItem.id, MISSING_ID);
      await postConclude(headers, id, fillingItem.id);
      const finished = await deleteBatch(headers, id, fillingItem.id, batchId);

      expect(other.statusCode).toBe(404);
      expect(other.json().message).toBe("Batch not found.");
      expect(missing.statusCode).toBe(404);
      expect(finished.statusCode).toBe(409);
      expect(finished.json().message).toBe("The item is not pending.");
      expect(await testPrisma.productionItemBatch.count()).toBe(1);
    });

    it("refuses damage and substitute on an item with a batch", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const reason = await testPrisma.lossReason.create({ data: { name: "Queimou" } });
      await postBatch(headers, id, fillingItem.id, batchOf("0.4"));

      const damage = await postDamage(headers, id, fillingItem.id, { reasonId: reason.id });
      const substitute = await postSubstitute(headers, id, fillingItem.id);

      expect([damage.statusCode, substitute.statusCode]).toEqual([409, 409]);
      expect(damage.json().message).toBe(alreadyHasBatches);
      expect(substitute.json().message).toBe(alreadyHasBatches);
    });

    it("refuses damage and substitute on an item with an extra weighing", async () => {
      const { headers, userId } = await canDoBoth();
      const tree = await bonbonTree(userId);
      const { id, fillingItem } = await startTree(headers, tree);
      const reason = await testPrisma.lossReason.create({ data: { name: "Queimou" } });
      const extra = await testPrisma.preWeighing.create({
        data: { productSku: tree.filling.sku, quantity: "0.1", createdById: userId },
      });
      await testPrisma.productionItemWeighing.create({
        data: { productionItemId: fillingItem.id, preWeighingId: extra.id },
      });

      const damage = await postDamage(headers, id, fillingItem.id, { reasonId: reason.id });
      const substitute = await postSubstitute(headers, id, fillingItem.id);

      expect(damage.json().message).toBe(alreadyHasBatches);
      expect(substitute.json().message).toBe(alreadyHasBatches);
    });
  });
});

describe("POST /v1/productions/:id/cancel", () => {
  it("brings a batch whose cost does not fit in at the product's average cost, instead of refusing", async () => {
    const { headers } = await canDoBoth();
    const { dough, flour } = await createDough();
    await stock(flour.sku, "100", "900000000000");
    await stock(dough.sku, "10", "3");
    const production = (await postProduction(headers, { items: [{ productSku: dough.sku, quantity: "50" }] })).json();
    const itemId = production.items[0].id;
    await postBatch(headers, production.id, itemId, { quantity: "0.001", expiresAt: null, source: "PRODUCED" });

    const response = await postCancel(headers, production.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "CANCELED", items: [{ status: "FINISHED", unitCost: "3" }] });
    const made = await testPrisma.stockLot.findFirstOrThrow({
      where: { productSku: dough.sku, initialQuantity: "0.001" },
    });
    expect(made.unitCost.toString()).toBe("3");
  });

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
    await makeItem(headers, production.id, production.items[0].id, "50");

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

    const batch = await postBatch(headers, production.id, production.items[0].id, {
      quantity: "50",
      expiresAt: null,
      source: "PRODUCED",
    });
    const response = await postConclude(headers, production.id, production.items[0].id);

    expect(batch.statusCode).toBe(409);
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

describe("concluding two productions that share inputs at the same time", () => {
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

  // A production of one unit of a product, its batch already recorded.
  async function startOf(headers: Headers, productSku: string) {
    const production = (await postProduction(headers, { items: [{ productSku, quantity: "1" }] })).json();
    const itemId = production.items[0].id as string;

    await postBatch(headers, production.id, itemId, { quantity: "1", expiresAt: null, source: "PRODUCED" });

    return { id: production.id as string, itemId };
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

  it("concludes both, whatever the order each of them reaches the inputs in", async () => {
    const { headers } = await canDoBoth();
    const sugar = await createProduct("Sugar");
    const flour = await createProduct("Flour");
    const egg = await createProduct("Egg");
    const milk = await createProduct("Milk");

    // The first takes egg, flour and sugar; the second flour, milk and sugar.
    const dough = await createMade("Alpha dough", [sugar.sku, egg.sku, flour.sku]);
    const mix = await createMade("Gamma mix", [flour.sku, milk.sku, sugar.sku]);
    const first = await startOf(headers, dough.sku);
    const second = await startOf(headers, mix.sku);

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

    const finishing = [first, second].map(({ id, itemId }) => postConclude(headers, id, itemId));

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

  // Each item made of one batch of 1 and concluded, one after the other.
  async function finishAll(headers: Headers, production: { id: string; items: { id: string }[] }, body = {}) {
    let response;

    for (const { id } of production.items) response = await makeItem(headers, production.id, id, "1", body);

    return response!;
  }

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

  it("discards at each conclusion what the can it opened leaves, the next item opening another", async () => {
    // A flan and a pudding, 100 g each, out of the same can lot: the first opens a can for 100 g and
    // discards its other 295 g, and so does the second.
    const { headers } = await canDoBoth();
    const { milkLot, production } = await startPudding(headers, { withFlan: true, dose: "100" });

    const response = await finishAll(headers, production);

    expect(await lotQuantity(milkLot.id)).toBe("3160");
    const leftovers = await testPrisma.productionLeftover.findMany();
    expect(leftovers.map(({ quantity }) => quantity.toString())).toEqual(["295", "295"]);
    expect(response.json().items.map(({ unitCost }: { unitCost: string }) => unitCost)).toEqual(["7.9", "7.9"]);
  });

  it("previews the items asked for together, sharing an opened can", async () => {
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

describe("POST /v1/productions without a pre-weighing, with intermediates", () => {
  // 50 bonbons take 1 kg of filling (0.3 in stock) and 50 shells (none in stock); the shell is made
  // of tempered chocolate, itself made of cocoa, so the tree has two levels under the shell.
  async function bonbonRecipes(fillingInStock = "0.3") {
    const [bonbon, filling, shell, tempered, cocoa, milk] = await Promise.all([
      createProduct("Bonbon", { kind: "MANUFACTURED", unit: "UNIT" }),
      createProduct("Filling", { kind: "MANUFACTURED" }),
      createProduct("Shell", { kind: "MANUFACTURED", unit: "UNIT" }),
      createProduct("Tempered chocolate", { kind: "MANUFACTURED" }),
      createProduct("Cocoa"),
      createProduct("Condensed milk"),
    ]);
    const recipe = (
      productSku: string,
      yieldQuantity: string,
      ingredients: { productSku: string; quantity: string }[],
    ) => testPrisma.recipe.create({ data: { productSku, yieldQuantity, ingredients: { create: ingredients } } });

    await recipe(bonbon.sku, "10", [
      { productSku: filling.sku, quantity: "0.2" },
      { productSku: shell.sku, quantity: "10" },
    ]);
    await recipe(filling.sku, "1", [{ productSku: milk.sku, quantity: "1" }]);
    await recipe(shell.sku, "100", [{ productSku: tempered.sku, quantity: "1" }]);
    await recipe(tempered.sku, "1", [{ productSku: cocoa.sku, quantity: "2" }]);
    await stock(filling.sku, fillingInStock, "1");

    return { bonbon, filling, shell, tempered, cocoa, milk };
  }

  type StartedItem = { id: string; product: { sku: string }; expectedQuantity: string; dependsOn: string[] };
  const itemOf = (items: StartedItem[], sku: string) => items.find((item) => item.product.sku === sku);

  it("brings in, as items, the intermediates the stock does not cover", async () => {
    const { headers } = await canCreate();
    const { bonbon, filling, shell, tempered } = await bonbonRecipes();

    const response = await postProduction(headers, { items: [{ productSku: bonbon.sku, quantity: "50" }] });

    expect(response.statusCode).toBe(201);
    const items: StartedItem[] = response.json().items;
    expect(items).toHaveLength(4);
    expect(itemOf(items, filling.sku)?.expectedQuantity).toBe("0.7");
    expect(itemOf(items, shell.sku)?.expectedQuantity).toBe("50");
    expect(itemOf(items, tempered.sku)?.expectedQuantity).toBe("0.5");
    expect(itemOf(items, bonbon.sku)?.dependsOn).toEqual(
      expect.arrayContaining([itemOf(items, filling.sku)!.id, itemOf(items, shell.sku)!.id]),
    );
    expect(itemOf(items, shell.sku)?.dependsOn).toEqual([itemOf(items, tempered.sku)!.id]);
  });

  it("plans each item against the stock of its intermediates that the items before it leave", async () => {
    const { headers } = await canCreate();
    const { bonbon, filling } = await bonbonRecipes("0.8");

    // 25 bonbons take 0.5 kg of filling: the first takes it from the 0.8 in stock, the second makes what is left short.
    const response = await postProduction(headers, {
      items: [
        { productSku: bonbon.sku, quantity: "25" },
        { productSku: bonbon.sku, quantity: "25" },
      ],
    });

    expect(response.statusCode).toBe(201);
    const items: StartedItem[] = response.json().items;
    const fillings = items.filter((item) => item.product.sku === filling.sku);
    expect(fillings.map(({ expectedQuantity }) => expectedQuantity)).toEqual(["0.2"]);
    // The second item's own tree comes after it: its filling is its stage.
    expect(items.map(({ product }) => product.sku).indexOf(filling.sku)).toBeGreaterThan(
      items.map(({ product }) => product.sku).lastIndexOf(bonbon.sku),
    );
  });

  it("makes as much of an intermediate as the operator asked for", async () => {
    const { headers } = await canCreate();
    const { bonbon, filling } = await bonbonRecipes();

    const response = await postProduction(headers, {
      items: [{ productSku: bonbon.sku, quantity: "50", produce: [{ productSku: filling.sku, quantity: "1" }] }],
    });

    expect(response.statusCode).toBe(201);
    expect(itemOf(response.json().items, filling.sku)?.expectedQuantity).toBe("1");
  });

  it("takes an intermediate set to zero from stock, with no item for it", async () => {
    const { headers } = await canCreate();
    const { bonbon, filling } = await bonbonRecipes();

    const response = await postProduction(headers, {
      items: [{ productSku: bonbon.sku, quantity: "50", produce: [{ productSku: filling.sku, quantity: "0" }] }],
    });

    expect(response.statusCode).toBe(201);
    const items: StartedItem[] = response.json().items;
    expect(itemOf(items, filling.sku)).toBeUndefined();
    expect(items).toHaveLength(3);
    expect(itemOf(items, bonbon.sku)?.dependsOn).toHaveLength(1);
  });

  it("refuses a quantity to make with more places than the intermediate's unit allows", async () => {
    const { headers } = await canCreate();
    const { bonbon, shell } = await bonbonRecipes();

    const response = await postProduction(headers, {
      items: [{ productSku: bonbon.sku, quantity: "50", produce: [{ productSku: shell.sku, quantity: "2.5" }] }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The quantity has more decimal places than the unit allows.");
    expect(await testPrisma.production.count()).toBe(0);
  });

  it("refuses an intermediate named twice", async () => {
    const { headers } = await canCreate();
    const { bonbon, filling } = await bonbonRecipes();

    const response = await postProduction(headers, {
      items: [
        {
          productSku: bonbon.sku,
          quantity: "50",
          produce: [
            { productSku: filling.sku, quantity: "1" },
            { productSku: filling.sku.toUpperCase(), quantity: "2" },
          ],
        },
      ],
    });

    expect(response.statusCode).toBe(400);
  });
});
