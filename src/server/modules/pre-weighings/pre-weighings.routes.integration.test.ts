import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeasurementUnit, Permission, ProductKind } from "@prisma/client";
import { createBodyOf, weighingRowsOf } from "@/features/pre-weighings/plan-tree";
import * as preWeighingById from "@/app/v1/pre-weighings/[id]/route";
import * as preWeighingPlan from "@/app/v1/pre-weighings/plan/route";
import * as preWeighings from "@/app/v1/pre-weighings/route";
import * as staleCount from "@/app/v1/pre-weighings/stale-count/route";
import * as startCandidates from "@/app/v1/pre-weighings/start-candidates/route";
import { findPreWeighingTree } from "./pre-weighings.repository";
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
async function createDough(overrides: ProductOverrides = {}) {
  const [dough, flour, water] = await Promise.all([
    createProduct("Bread dough", { kind: "MANUFACTURED", ...overrides }),
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

const getPlan = (headers: Headers, query: Record<string, string | string[]>) =>
  inject(preWeighingPlan, { method: "GET", url: "/v1/pre-weighings/plan", headers, query });

const postPreWeighing = (headers: Headers, payload: Record<string, unknown>) =>
  inject(preWeighings, { method: "POST", url: "/v1/pre-weighings", headers, payload });

const getPreWeighing = (headers: Headers, id: string) =>
  inject(preWeighingById, { method: "GET", url: `/v1/pre-weighings/${id}`, params: { id }, headers });

const deletePreWeighing = (headers: Headers, id: string) =>
  inject(preWeighingById, { method: "DELETE", url: `/v1/pre-weighings/${id}`, params: { id }, headers });

const listPreWeighings = (headers: Headers, query: Record<string, string> = {}) =>
  inject(preWeighings, { method: "GET", url: "/v1/pre-weighings", headers, query });

const canRead = () => authenticateAs([Permission.PRODUCTION_READ]);
const canCreate = () => authenticateAs([Permission.PRODUCTION_CREATE]);

describe("GET /v1/pre-weighings/plan", () => {
  it("scales the recipe to the quantity to produce", async () => {
    const { headers } = await canRead();
    const { dough, flour, water } = await createDough();

    const response = await getPlan(headers, { productSku: dough.sku, quantity: "50" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
      quantity: "50",
      items: [
        {
          product: { sku: water.sku, description: "Water", unit: "LITER" },
          plannedQuantity: "18",
          lots: [],
          shortfall: "18",
          manufactured: null,
        },
        {
          product: { sku: flour.sku, description: "Wheat flour", unit: "KILOGRAM" },
          plannedQuantity: "30",
          lots: [],
          shortfall: "30",
          manufactured: null,
        },
      ],
      waste: null,
    });
  });

  it("prices what the cans that cannot be kept leave behind, and offers a quantity that closes them", async () => {
    const { headers } = await canRead();
    const pudding = await createProduct("Pudding", { kind: "MANUFACTURED" });
    const milk = await testPrisma.product.create({
      data: { description: "Condensed milk", kind: "GOODS", unit: "GRAM", isStorableOnceOpened: false },
    });
    const can = await testPrisma.productPackaging.create({
      data: { productSku: milk.sku, brand: "MOÇA", content: "395" },
    });
    await testPrisma.recipe.create({
      data: {
        productSku: pudding.sku,
        yieldQuantity: "1",
        ingredients: { create: [{ productSku: milk.sku, quantity: "300" }] },
      },
    });
    await testPrisma.productStock.create({ data: { productSku: milk.sku, quantity: "3950", averageCost: "0.02" } });
    await testPrisma.stockLot.create({
      data: {
        productSku: milk.sku,
        packagingId: can.id,
        packageCount: 10,
        packagePrice: "7.90",
        initialQuantity: "3950",
        quantity: "3950",
        unitCost: "0.02",
      },
    });

    const response = await getPlan(headers, { productSku: pudding.sku, quantity: "10", tolerance: "20" });

    expect(response.statusCode).toBe(200);
    expect(response.json().waste).toMatchObject({
      tolerance: 20,
      requested: {
        quantity: "10",
        loss: "3.20",
        leftovers: [{ product: { sku: milk.sku }, leftover: "160", loss: "3.20" }],
      },
      unpackaged: [],
      uncosted: [],
    });
    expect(response.json().waste.alternatives[0]).toMatchObject({ quantity: "10.533", loss: "0.00" });
  });

  it("answers 400 for a tolerance out of 0 to 100", async () => {
    const { headers } = await canRead();
    const { dough } = await createDough();

    expect((await getPlan(headers, { productSku: dough.sku, quantity: "10", tolerance: "101" })).statusCode).toBe(400);
  });

  it("tells which lots to weigh each ingredient from, the first to expire first, leaving expired ones out", async () => {
    const { headers } = await canRead();
    const { dough, flour } = await createDough();
    const lotOf = (quantity: string, expiresAt: string | null) =>
      testPrisma.stockLot.create({
        data: {
          productSku: flour.sku,
          quantity,
          initialQuantity: quantity,
          unitCost: "2",
          expiresAt: expiresAt === null ? null : new Date(expiresAt),
        },
      });
    const never = await lotOf("100", null);
    const sooner = await lotOf("20", "2099-01-31");
    await lotOf("50", "2020-01-01");
    const later = await lotOf("4", "2099-06-30");

    const response = await getPlan(headers, { productSku: dough.sku, quantity: "50" });
    const [, ofFlour] = response.json().items;

    expect(ofFlour).toMatchObject({
      plannedQuantity: "30",
      lots: [
        { id: sooner.id, expiresAt: "2099-01-31", quantity: "20" },
        { id: later.id, expiresAt: "2099-06-30", quantity: "4" },
        { id: never.id, expiresAt: null, quantity: "6" },
      ],
      shortfall: "0",
    });
  });

  it("tells how much of an ingredient the lots do not cover", async () => {
    const { headers } = await canRead();
    const { dough, flour } = await createDough();
    await testPrisma.stockLot.create({
      data: { productSku: flour.sku, quantity: "12.5", initialQuantity: "20", unitCost: "2" },
    });

    const [, ofFlour] = (await getPlan(headers, { productSku: dough.sku, quantity: "50" })).json().items;

    expect(ofFlour.lots).toEqual([{ id: expect.any(String), expiresAt: null, quantity: "12.5" }]);
    expect(ofFlour.shortfall).toBe("17.5");
  });

  it("writes nothing", async () => {
    const { headers } = await canRead();
    const { dough } = await createDough();

    await getPlan(headers, { productSku: dough.sku, quantity: "50" });

    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await canRead();

    expect((await getPlan(headers, { productSku: MISSING_ID, quantity: "1" })).statusCode).toBe(404);
  });

  it("answers 409 for a product that has no recipe", async () => {
    const { headers } = await canRead();
    const product = await createProduct("Filling", { kind: "MANUFACTURED" });

    expect((await getPlan(headers, { productSku: product.sku, quantity: "1" })).statusCode).toBe(409);
  });

  it("answers 409 for an inactive product", async () => {
    const { headers } = await canRead();
    const { dough } = await createDough({ isActive: false });

    expect((await getPlan(headers, { productSku: dough.sku, quantity: "1" })).statusCode).toBe(409);
  });

  it("answers 409 when the recipe takes an inactive ingredient", async () => {
    const { headers } = await canRead();
    const { dough, flour } = await createDough();
    await testPrisma.product.update({ where: { sku: flour.sku }, data: { isActive: false } });

    expect((await getPlan(headers, { productSku: dough.sku, quantity: "1" })).statusCode).toBe(409);
  });

  it("answers 409 for a quantity too small to give every ingredient a weight", async () => {
    const { headers } = await canRead();
    const { dough } = await createDough();

    expect((await getPlan(headers, { productSku: dough.sku, quantity: "0.000001" })).statusCode).toBe(409);
  });

  it.each([
    ["a zero quantity", { quantity: "0" }],
    ["a quantity that is not a decimal", { quantity: "plenty" }],
    ["a missing quantity", {}],
  ])("answers 400 for %s", async (_label, query: Record<string, string>) => {
    const { headers } = await canRead();
    const { dough } = await createDough();

    expect((await getPlan(headers, { productSku: dough.sku, ...query })).statusCode).toBe(400);
  });

  it("answers 403 without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect((await getPlan(headers, { productSku: MISSING_ID, quantity: "1" })).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await getPlan(undefined, { productSku: MISSING_ID, quantity: "1" })).statusCode).toBe(401);
  });
});

// Bonbon: 10 units out of 0.2 kg of filling, 10 shells and 0.05 kg of sprinkles. The filling (1 kg)
// is made of 0.8 kg of condensed milk and 0.2 kg of chocolate; the shells (100 units) of 1 kg of chocolate.
async function createBonbon() {
  const [bonbon, filling, shell, sprinkles, milk, chocolate] = await Promise.all([
    createProduct("Bonbon", { kind: "MANUFACTURED", unit: "UNIT" }),
    createProduct("Filling", { kind: "MANUFACTURED" }),
    createProduct("Shell", { kind: "MANUFACTURED", unit: "UNIT" }),
    createProduct("Sprinkles"),
    createProduct("Condensed milk"),
    createProduct("Chocolate"),
  ]);
  const recipe = (productSku: string, yieldQuantity: string, ingredients: { productSku: string; quantity: string }[]) =>
    testPrisma.recipe.create({ data: { productSku, yieldQuantity, ingredients: { create: ingredients } } });

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
  await testPrisma.productStock.create({ data: { productSku: filling.sku, quantity: "0.3", averageCost: "1" } });
  await testPrisma.stockLot.create({
    data: { productSku: filling.sku, initialQuantity: "0.3", quantity: "0.3", unitCost: "1" },
  });

  return { bonbon, filling, shell, sprinkles, milk, chocolate };
}

type PlanBody = {
  quantity: string;
  items: {
    product: { sku: string };
    plannedQuantity: string;
    manufactured: { needed: string; inStock: string; toProduce: string; stage: PlanBody | null } | null;
  }[];
};

// A manufactured item and its stage, which a test reads without checking for null at every step.
const itemOf = (plan: PlanBody, sku: string) => {
  const item = plan.items.find((candidate) => candidate.product.sku === sku);

  if (item === undefined) throw new Error(`No item for ${sku}.`);

  return item as typeof item & { manufactured: NonNullable<typeof item.manufactured> & { stage: PlanBody } };
};

describe("GET /v1/pre-weighings/plan with intermediates", () => {
  it("plans each intermediate's shortfall by default", async () => {
    const { headers } = await canRead();
    const { bonbon, filling, shell, sprinkles, milk, chocolate } = await createBonbon();

    const response = await getPlan(headers, { productSku: bonbon.sku, quantity: "50" });

    expect(response.statusCode).toBe(200);
    const plan = response.json();
    const fillingItem = itemOf(plan, filling.sku);

    expect(fillingItem.manufactured).toMatchObject({ needed: "1", inStock: "0.3", toProduce: "0.7" });
    expect(fillingItem.manufactured.stage.quantity).toBe("0.7");
    expect(itemOf(fillingItem.manufactured.stage, milk.sku).plannedQuantity).toBe("0.56");
    expect(itemOf(fillingItem.manufactured.stage, chocolate.sku).plannedQuantity).toBe("0.14");
    expect(itemOf(plan, shell.sku).manufactured).toMatchObject({ toProduce: "50" });
    expect(itemOf(plan, sprinkles.sku).manufactured).toBeNull();
  });

  it("takes ready material when told to produce nothing", async () => {
    const { headers } = await canRead();
    const { bonbon, filling } = await createBonbon();

    const response = await getPlan(headers, { productSku: bonbon.sku, quantity: "50", produce: `${filling.sku}:0` });

    expect(itemOf(response.json(), filling.sku).manufactured).toMatchObject({ toProduce: "0", stage: null });
  });

  it("produces more than needed when told to", async () => {
    const { headers } = await canRead();
    const { bonbon, filling } = await createBonbon();

    const response = await getPlan(headers, { productSku: bonbon.sku, quantity: "50", produce: `${filling.sku}:2` });

    expect(itemOf(response.json(), filling.sku).manufactured.stage.quantity).toBe("2");
  });

  it("plans an intermediate of an intermediate", async () => {
    const { headers } = await canRead();
    const { bonbon, shell, chocolate } = await createBonbon();
    const tempered = await createProduct("Tempered chocolate", { kind: "MANUFACTURED" });
    const cocoa = await createProduct("Cocoa");

    await testPrisma.recipe.create({
      data: {
        productSku: tempered.sku,
        yieldQuantity: "1",
        ingredients: { create: [{ productSku: cocoa.sku, quantity: "2" }] },
      },
    });
    await testPrisma.recipe.update({
      where: { productSku: shell.sku },
      data: {
        ingredients: {
          deleteMany: { productSku: chocolate.sku },
          create: [{ productSku: tempered.sku, quantity: "1" }],
        },
      },
    });

    const response = await getPlan(headers, { productSku: bonbon.sku, quantity: "50" });

    const shellStage = itemOf(response.json(), shell.sku).manufactured.stage;
    const temperedItem = itemOf(shellStage, tempered.sku);

    expect(temperedItem.manufactured).toMatchObject({ needed: "0.5", toProduce: "0.5" });
    expect(itemOf(temperedItem.manufactured.stage, cocoa.sku).plannedQuantity).toBe("1");
  });

  it("applies one produce entry wherever the intermediate appears", async () => {
    const { headers } = await canRead();
    const { bonbon, filling, shell } = await createBonbon();

    await testPrisma.recipe.update({
      where: { productSku: shell.sku },
      data: { ingredients: { create: [{ productSku: filling.sku, quantity: "10" }] } },
    });

    const response = await getPlan(headers, { productSku: bonbon.sku, quantity: "50", produce: `${filling.sku}:3` });

    const plan = response.json();
    const inShell = itemOf(itemOf(plan, shell.sku).manufactured.stage, filling.sku);

    expect(itemOf(plan, filling.sku).manufactured.toProduce).toBe("3");
    expect(inShell.manufactured.toProduce).toBe("3");
  });

  it("takes from stock, by default, an intermediate that has no recipe", async () => {
    const { headers } = await canRead();
    const { bonbon, filling } = await createBonbon();

    await testPrisma.recipe.delete({ where: { productSku: filling.sku } });

    const response = await getPlan(headers, { productSku: bonbon.sku, quantity: "50" });

    expect(response.statusCode).toBe(200);
    expect(itemOf(response.json(), filling.sku).manufactured).toMatchObject({
      needed: "1",
      inStock: "0.3",
      toProduce: "0",
      stage: null,
    });
  });

  it("takes from stock, by default, an intermediate whose recipe takes an inactive product", async () => {
    const { headers } = await canRead();
    const { bonbon, filling, milk, shell } = await createBonbon();

    await testPrisma.product.update({ where: { sku: milk.sku }, data: { isActive: false } });

    const response = await getPlan(headers, { productSku: bonbon.sku, quantity: "50" });

    expect(response.statusCode).toBe(200);
    expect(itemOf(response.json(), filling.sku).manufactured).toMatchObject({ toProduce: "0", stage: null });
    expect(itemOf(response.json(), shell.sku).manufactured).toMatchObject({ toProduce: "50" });
  });

  it("refuses to produce an intermediate that has no recipe when told to", async () => {
    const { headers } = await canRead();
    const { bonbon, filling } = await createBonbon();

    await testPrisma.recipe.delete({ where: { productSku: filling.sku } });

    const response = await getPlan(headers, { productSku: bonbon.sku, quantity: "50", produce: `${filling.sku}:1` });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("Product has no recipe.");
  });

  it("refuses a quantity to produce with more places than the unit allows", async () => {
    const { headers } = await canRead();
    const { bonbon, shell } = await createBonbon();

    const response = await getPlan(headers, { productSku: bonbon.sku, quantity: "50", produce: `${shell.sku}:2.5` });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The quantity has more decimal places than the unit allows.");
  });

  it("refuses a product listed twice in produce", async () => {
    const { headers } = await canRead();
    const { bonbon, filling } = await createBonbon();

    const response = await getPlan(headers, {
      productSku: bonbon.sku,
      quantity: "50",
      produce: [`${filling.sku}:1`, `${filling.sku}:2`],
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /v1/pre-weighings", () => {
  it("records what was weighed next to what the recipe planned", async () => {
    const { headers, userId } = await canCreate();
    const { dough, flour, water } = await createDough();

    const response = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: [
        { productSku: flour.sku, weighedQuantity: "30.25" },
        { productSku: water.sku, weighedQuantity: "17.9" },
      ],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      product: { sku: dough.sku, description: "Bread dough", unit: "KILOGRAM" },
      quantity: "50",
      items: [
        { product: { sku: water.sku, unit: "LITER" }, plannedQuantity: "18", weighedQuantity: "17.9" },
        { product: { sku: flour.sku, unit: "KILOGRAM" }, plannedQuantity: "30", weighedQuantity: "30.25" },
      ],
    });

    const stored = await testPrisma.preWeighing.findMany({ include: { items: true } });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: response.json().id, productSku: dough.sku, createdById: userId });
    expect(stored[0]!.items).toHaveLength(2);
  });

  it("keeps the planned quantities it recorded when the recipe changes afterwards", async () => {
    const { headers } = await canCreate();
    const { dough, flour, water } = await createDough();
    const response = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: [
        { productSku: flour.sku, weighedQuantity: "30" },
        { productSku: water.sku, weighedQuantity: "18" },
      ],
    });

    await testPrisma.recipeIngredient.updateMany({ data: { quantity: "1" } });

    const items = await testPrisma.preWeighingItem.findMany({ where: { preWeighingId: response.json().id } });

    expect(items.map((item) => item.plannedQuantity.toString()).sort()).toEqual(["18", "30"]);
  });

  it("leaves the stock untouched", async () => {
    const { headers } = await canCreate();
    const { dough, flour, water } = await createDough();
    await testPrisma.productStock.create({ data: { productSku: flour.sku, quantity: "100" } });

    await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: [
        { productSku: flour.sku, weighedQuantity: "30" },
        { productSku: water.sku, weighedQuantity: "18" },
      ],
    });

    const stock = await testPrisma.productStock.findUnique({ where: { productSku: flour.sku } });

    expect(stock?.quantity.toString()).toBe("100");
    expect(await testPrisma.stockMovement.count()).toBe(0);
  });

  it.each([
    ["leave an ingredient of the recipe out", (skus: Skus) => [{ productSku: skus.flour, weighedQuantity: "30" }]],
    [
      "bring a product the recipe does not take",
      (skus: Skus) => [
        { productSku: skus.flour, weighedQuantity: "30" },
        { productSku: skus.water, weighedQuantity: "18" },
        { productSku: skus.salt, weighedQuantity: "1" },
      ],
    ],
  ])("answers 409 when the items %s, and writes nothing", async (_label, itemsFor) => {
    const { headers } = await canCreate();
    const { dough, flour, water } = await createDough();
    const salt = await createProduct("Salt");

    const response = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: itemsFor({ flour: flour.sku, water: water.sku, salt: salt.sku }),
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("answers 404 for a product that does not exist", async () => {
    const { headers } = await canCreate();

    const response = await postPreWeighing(headers, {
      productSku: MISSING_ID,
      quantity: "1",
      items: [{ productSku: MISSING_ID, weighedQuantity: "1" }],
    });

    expect(response.statusCode).toBe(404);
  });

  it("answers 409 for a product that has no recipe, and writes nothing", async () => {
    const { headers } = await canCreate();
    const product = await createProduct("Filling", { kind: "MANUFACTURED" });
    const flour = await createProduct("Wheat flour");

    const response = await postPreWeighing(headers, {
      productSku: product.sku,
      quantity: "1",
      items: [{ productSku: flour.sku, weighedQuantity: "1" }],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it.each([
    ["a zero quantity", { quantity: "0" }],
    ["a missing quantity", { quantity: undefined }],
    ["a zero weighed quantity", { weighedQuantity: "0" }],
    ["a weighed quantity with more than six decimal places", { weighedQuantity: "1.0000001" }],
    ["the same item twice", { repeat: true }],
  ])("answers 400 for %s", async (_label, change: Record<string, unknown>) => {
    const { headers } = await canCreate();
    const { dough, flour, water } = await createDough();
    const weighedQuantity = "weighedQuantity" in change ? change.weighedQuantity : "30";
    const items = [
      { productSku: flour.sku, weighedQuantity },
      { productSku: change.repeat ? flour.sku : water.sku, weighedQuantity: "18" },
    ];

    const response = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "quantity" in change ? change.quantity : "50",
      items: change.items ?? items,
    });

    expect(response.statusCode).toBe(400);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it.each([
    ["no item", { items: [] }],
    ["a missing weighed quantity", { items: "unweighed" }],
  ])("answers 409 for %s on a bought line, and writes nothing", async (_label, change) => {
    const { headers } = await canCreate();
    const { dough, flour, water } = await createDough();

    const response = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items:
        change.items === "unweighed"
          ? [{ productSku: flour.sku }, { productSku: water.sku, weighedQuantity: "18" }]
          : change.items,
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await postPreWeighing(headers, {})).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postPreWeighing(undefined, {})).statusCode).toBe(401);
  });
});

const NOT_MATCHING = "A stage does not match the plan.";

// The tree the plan of 50 bonbons asks for: 0.7 of filling out of what the stock lacks, and 50 shells.
// The manufactured lines go unweighed, as the screen sends them.
async function bonbonTree() {
  const products = await createBonbon();
  const { bonbon, filling, shell, sprinkles, milk, chocolate } = products;
  const body = {
    productSku: bonbon.sku,
    quantity: "50",
    items: [
      { productSku: filling.sku },
      { productSku: shell.sku },
      { productSku: sprinkles.sku, weighedQuantity: "0.25" },
    ] as { productSku: string; weighedQuantity?: string }[],
    stages: [
      {
        productSku: filling.sku,
        quantity: "0.7",
        items: [
          { productSku: milk.sku, weighedQuantity: "0.56" },
          { productSku: chocolate.sku, weighedQuantity: "0.14" },
        ],
      },
      { productSku: shell.sku, quantity: "50", items: [{ productSku: chocolate.sku, weighedQuantity: "0.5" }] },
    ],
  };

  return { ...products, body };
}

describe("POST /v1/pre-weighings with intermediates", () => {
  it("records the bonbon and its intermediates in one call", async () => {
    const { headers } = await authenticateAs([Permission.PRODUCTION_READ, Permission.PRODUCTION_CREATE]);
    const { body, filling, shell } = await bonbonTree();

    const response = await postPreWeighing(headers, body);

    expect(response.statusCode).toBe(201);
    const root = response.json();

    expect(root.parent).toBeNull();
    expect(root.children).toEqual(
      expect.arrayContaining([
        { id: expect.any(String), product: expect.objectContaining({ sku: filling.sku }), quantity: "0.7" },
        { id: expect.any(String), product: expect.objectContaining({ sku: shell.sku }), quantity: "50" },
      ]),
    );
    expect(root.children).toHaveLength(2);
    expect(root.items.find((item: { product: { sku: string } }) => item.product.sku === filling.sku)).toMatchObject({
      plannedQuantity: "1",
      weighedQuantity: null,
    });
    expect(await testPrisma.preWeighing.count()).toBe(3);

    for (const child of root.children) {
      const stored = (await getPreWeighing(headers, child.id)).json();

      expect(stored.parent).toEqual({ id: root.id, product: expect.objectContaining({ description: "Bonbon" }) });
    }
  });

  it("refuses a weighing on a manufactured line", async () => {
    const { headers } = await canCreate();
    const { body, filling } = await bonbonTree();

    const response = await postPreWeighing(headers, {
      ...body,
      items: body.items.map((item) => (item.productSku === filling.sku ? { ...item, weighedQuantity: "1" } : item)),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The items do not match the ingredients of the recipe.");
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("refuses a stage whose items disagree with the plan", async () => {
    const { headers } = await canCreate();
    const { body, filling, milk } = await bonbonTree();

    const response = await postPreWeighing(headers, {
      ...body,
      stages: [
        { productSku: filling.sku, quantity: "0.7", items: [{ productSku: milk.sku, weighedQuantity: "0.5" }] },
        body.stages[1],
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("refuses the same intermediate in two quantities", async () => {
    const { headers } = await canCreate();
    const { body } = await bonbonTree();

    const response = await postPreWeighing(headers, {
      ...body,
      stages: [...body.stages, { ...body.stages[1], quantity: "40" }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe(NOT_MATCHING);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("refuses a stage for a product the recipe buys", async () => {
    const { headers } = await canCreate();
    const { body, sprinkles } = await bonbonTree();

    const response = await postPreWeighing(headers, {
      ...body,
      stages: [...body.stages, { productSku: sprinkles.sku, quantity: "1", items: [] }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe(NOT_MATCHING);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("refuses a manufactured line left out", async () => {
    const { headers } = await canCreate();
    const { body, filling } = await bonbonTree();

    const response = await postPreWeighing(headers, {
      ...body,
      items: body.items.filter((item) => item.productSku !== filling.sku),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The items do not match the ingredients of the recipe.");
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("refuses a bought ingredient left unweighed", async () => {
    const { headers } = await canCreate();
    const { body, sprinkles } = await bonbonTree();

    const response = await postPreWeighing(headers, {
      ...body,
      items: body.items.map((item) => (item.productSku === sprinkles.sku ? { productSku: sprinkles.sku } : item)),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The items do not match the ingredients of the recipe.");
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });

  it("takes a manufactured ingredient with no stage from stock", async () => {
    const { headers } = await canCreate();
    const { body, filling } = await bonbonTree();

    const response = await postPreWeighing(headers, { ...body, stages: [body.stages[1]] });

    // The filling is short in stock: with no stage the plan takes none to produce, which is allowed.
    expect(response.statusCode).toBe(201);
    expect(response.json().children).toHaveLength(1);
    expect(response.json().children[0].product.sku).not.toBe(filling.sku);
  });
});

// What the screen sends for a plan: every line weighed at what was planned.
async function recordAsTheScreenDoes(headers: Headers, query: Record<string, string | string[]>) {
  const plan = (await getPlan(headers, query)).json();
  const weighed = weighingRowsOf(plan).map(({ plannedQuantity }) => plannedQuantity);

  return { plan, response: await postPreWeighing(headers, createBodyOf(plan, weighed)) };
}

describe("POST /v1/pre-weighings of the body the screen builds", () => {
  const canDoBoth = () => authenticateAs([Permission.PRODUCTION_READ, Permission.PRODUCTION_CREATE]);

  it("records the bonbon with the filling and shells it makes", async () => {
    const { headers } = await canDoBoth();
    const { bonbon } = await createBonbon();

    const { response } = await recordAsTheScreenDoes(headers, { productSku: bonbon.sku, quantity: "50" });

    expect(response.statusCode).toBe(201);
    expect(response.json().children).toHaveLength(2);
    expect(await testPrisma.preWeighing.count()).toBe(3);
  });

  it("records the bonbon out of ready material", async () => {
    const { headers } = await canDoBoth();
    const { bonbon, filling, shell } = await createBonbon();

    const { response } = await recordAsTheScreenDoes(headers, {
      productSku: bonbon.sku,
      quantity: "50",
      produce: [`${filling.sku}:0`, `${shell.sku}:0`],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().children).toEqual([]);
    expect(await testPrisma.preWeighing.count()).toBe(1);
  });
});

describe("the same intermediate in two places of the tree", () => {
  const canDoBoth = () => authenticateAs([Permission.PRODUCTION_READ, Permission.PRODUCTION_CREATE]);

  // The shells take filling too: 0.4 per 100, so 0.2 for the 50 shells, next to the 1 the bonbons take.
  async function sharedFilling() {
    const products = await createBonbon();

    await testPrisma.recipe.update({
      where: { productSku: products.shell.sku },
      data: { ingredients: { create: [{ productSku: products.filling.sku, quantity: "0.4" }] } },
    });

    return products;
  }

  it("makes it once, at its first place, for what every place needs beyond the stock", async () => {
    const { headers } = await canDoBoth();
    const { bonbon, filling, shell } = await sharedFilling();

    const { plan, response } = await recordAsTheScreenDoes(headers, { productSku: bonbon.sku, quantity: "50" });

    const atRoot = itemOf(plan, filling.sku);
    const inShell = itemOf(itemOf(plan, shell.sku).manufactured.stage, filling.sku);

    expect(atRoot.manufactured).toMatchObject({ needed: "1", inStock: "0.3", toProduce: "0.9" });
    expect(atRoot.manufactured.stage.quantity).toBe("0.9");
    expect(inShell.manufactured).toMatchObject({ needed: "0.2", toProduce: "0.9", stage: null });
    expect(response.statusCode).toBe(201);
    expect(
      response
        .json()
        .children.map(({ quantity }: { quantity: string }) => quantity)
        .sort(),
    ).toEqual(["0.9", "50"]);
    expect(await testPrisma.preWeighing.count()).toBe(3);
  });

  it("makes what it is told to once", async () => {
    const { headers } = await canDoBoth();
    const { bonbon, filling, shell } = await sharedFilling();

    const { plan, response } = await recordAsTheScreenDoes(headers, {
      productSku: bonbon.sku,
      quantity: "50",
      produce: `${filling.sku}:2`,
    });

    expect(itemOf(plan, filling.sku).manufactured.stage.quantity).toBe("2");
    expect(itemOf(itemOf(plan, shell.sku).manufactured.stage, filling.sku).manufactured).toMatchObject({
      toProduce: "2",
      stage: null,
    });
    expect(response.statusCode).toBe(201);
    expect(await testPrisma.preWeighing.count()).toBe(3);
  });

  it("refuses the stage sent at the second place", async () => {
    const { headers } = await canDoBoth();
    const { bonbon, filling, shell, sprinkles, milk, chocolate } = await sharedFilling();
    const fillingStage = {
      productSku: filling.sku,
      quantity: "0.9",
      items: [
        { productSku: milk.sku, weighedQuantity: "0.72" },
        { productSku: chocolate.sku, weighedQuantity: "0.18" },
      ],
    };

    const response = await postPreWeighing(headers, {
      productSku: bonbon.sku,
      quantity: "50",
      items: [
        { productSku: filling.sku },
        { productSku: shell.sku },
        { productSku: sprinkles.sku, weighedQuantity: "0.25" },
      ],
      stages: [
        {
          productSku: shell.sku,
          quantity: "50",
          items: [{ productSku: chocolate.sku, weighedQuantity: "0.5" }, { productSku: filling.sku }],
          stages: [fillingStage],
        },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe(NOT_MATCHING);
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });
});

describe("POST /v1/pre-weighings of a stage at more places than its unit", () => {
  it.each([
    ["fractional shells", (body: Body) => ({ ...body.stages[1]!, quantity: "50.5" }), 1],
    ["filling to the tenth of a gram", (body: Body) => ({ ...body.stages[0]!, quantity: "0.7001" }), 0],
  ])("refuses %s", async (_label, stageOf, index) => {
    const { headers } = await canCreate();
    const { body } = await bonbonTree();
    const stages = [...body.stages];
    stages[index] = stageOf(body);

    const response = await postPreWeighing(headers, { ...body, stages });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The quantity has more decimal places than the unit allows.");
    expect(await testPrisma.preWeighing.count()).toBe(0);
  });
});

type Body = Awaited<ReturnType<typeof bonbonTree>>["body"];

describe("POST /v1/pre-weighings as a complement", () => {
  const complementOf = (parentId: string, body: Awaited<ReturnType<typeof bonbonTree>>) => ({
    parentId,
    productSku: body.filling.sku,
    quantity: "0.2",
    items: [
      { productSku: body.milk.sku, weighedQuantity: "0.16" },
      { productSku: body.chocolate.sku, weighedQuantity: "0.04" },
    ],
  });

  async function recordRoot() {
    const session = await authenticateAs([Permission.PRODUCTION_READ, Permission.PRODUCTION_CREATE]);
    const tree = await bonbonTree();
    const root = (await postPreWeighing(session.headers, tree.body)).json();

    return { ...session, tree, root };
  }

  it("records a complement under an existing pre-weighing", async () => {
    const { headers, tree, root } = await recordRoot();

    const response = await postPreWeighing(headers, complementOf(root.id, tree));

    expect(response.statusCode).toBe(201);
    expect(response.json().parent.id).toBe(root.id);
    expect((await getPreWeighing(headers, root.id)).json().children).toHaveLength(3);
  });

  it("refuses a complement whose parent does not take that product", async () => {
    const { headers, tree, root } = await recordRoot();
    const other = await createProduct("Other");
    const response = await postPreWeighing(headers, {
      parentId: root.id,
      productSku: tree.milk.sku,
      quantity: "1",
      items: [{ productSku: other.sku, weighedQuantity: "1" }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The parent's recipe does not take this product.");
  });

  // The parent guides an item of a production: `item` is that item's status, `production` the production's.
  async function guide(
    userId: string,
    tree: Awaited<ReturnType<typeof bonbonTree>>,
    rootId: string,
    state: { production: "IN_PROGRESS" | "FINISHED"; item: "PENDING" | "FINISHED" },
  ) {
    const finishedAt = state.item === "FINISHED" ? new Date() : null;

    return testPrisma.production.create({
      data: {
        status: state.production,
        finishedAt: state.production === "FINISHED" ? new Date() : null,
        createdById: userId,
        items: {
          create: [
            {
              productSku: tree.bonbon.sku,
              preWeighingId: rootId,
              expectedQuantity: "50",
              status: state.item,
              finishedAt,
            },
          ],
        },
      },
      include: { items: true },
    });
  }

  it("refuses a complement whose parent is in production, and records nothing", async () => {
    const { headers, userId, tree, root } = await recordRoot();
    await guide(userId, tree, root.id, { production: "IN_PROGRESS", item: "PENDING" });
    const before = await testPrisma.preWeighing.count();

    const response = await postPreWeighing(headers, complementOf(root.id, tree));

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The parent is in production; weigh more on the production screen.");
    expect(await testPrisma.preWeighing.count()).toBe(before);
  });

  it.each([
    ["of a production still in progress", "IN_PROGRESS"],
    ["of a finished production", "FINISHED"],
  ] as const)("refuses a complement whose parent was produced, %s", async (_label, production) => {
    const { headers, userId, tree, root } = await recordRoot();
    await guide(userId, tree, root.id, { production, item: "FINISHED" });

    const response = await postPreWeighing(headers, complementOf(root.id, tree));

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The parent has already been produced.");
  });

  it("refuses a complement whose parent was damaged", async () => {
    const { headers, userId, tree, root } = await recordRoot();
    const { items } = await guide(userId, tree, root.id, { production: "IN_PROGRESS", item: "PENDING" });
    const reason = await testPrisma.lossReason.create({ data: { name: "Queimou" } });
    // A damage lets go of the pre-weighing and keeps it, as the damage of a guided item does.
    await testPrisma.productionItem.update({ where: { id: items[0]!.id }, data: { preWeighingId: null } });
    await testPrisma.productionItemDamage.create({
      data: { productionItemId: items[0]!.id, preWeighingId: root.id, reasonId: reason.id, createdById: userId },
    });

    const response = await postPreWeighing(headers, complementOf(root.id, tree));

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe("The parent was damaged.");
  });

  it("records a complement under a parent a substituted item let go of", async () => {
    const { headers, userId, tree, root } = await recordRoot();
    const { items } = await guide(userId, tree, root.id, { production: "IN_PROGRESS", item: "PENDING" });
    // A substitute releases the pre-weighing: the item no longer points to it.
    await testPrisma.productionItem.update({
      where: { id: items[0]!.id },
      data: { status: "SUBSTITUTED", preWeighingId: null },
    });

    const response = await postPreWeighing(headers, complementOf(root.id, tree));

    expect(response.statusCode).toBe(201);
  });

  it("refuses a complement under a missing pre-weighing", async () => {
    const { headers, tree } = await recordRoot();

    const response = await postPreWeighing(headers, complementOf(MISSING_ID, tree));

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("Pre-weighing not found.");
  });
});

describe("GET /v1/pre-weighings/:id", () => {
  it("returns the pre-weighing as it was recorded", async () => {
    const { headers } = await authenticateAs([Permission.PRODUCTION_READ, Permission.PRODUCTION_CREATE]);
    const { dough, flour, water } = await createDough();
    const recorded = await postPreWeighing(headers, {
      productSku: dough.sku,
      quantity: "50",
      items: [
        { productSku: flour.sku, weighedQuantity: "30.25" },
        { productSku: water.sku, weighedQuantity: "17.9" },
      ],
    });

    const response = await getPreWeighing(headers, recorded.json().id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(recorded.json());
  });

  it("answers 404 for a pre-weighing that does not exist", async () => {
    const { headers } = await canRead();

    expect((await getPreWeighing(headers, MISSING_ID)).statusCode).toBe(404);
  });

  it("answers 403 without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect((await getPreWeighing(headers, MISSING_ID)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await getPreWeighing(undefined, MISSING_ID)).statusCode).toBe(401);
  });
});

describe("GET /v1/pre-weighings", () => {
  // Three pre-weighings of dough, recorded a day apart, named from the oldest to the newest.
  async function recordThree(userId: string) {
    const { dough, flour, water } = await createDough();
    const ids: string[] = [];

    for (const day of ["01", "02", "03"]) {
      const { id } = await testPrisma.preWeighing.create({
        data: {
          productSku: dough.sku,
          quantity: "50",
          createdById: userId,
          createdAt: new Date(`2026-10-${day}T12:00:00Z`),
          items: {
            create: [
              { productSku: flour.sku, plannedQuantity: "30", weighedQuantity: "30" },
              { productSku: water.sku, plannedQuantity: "18", weighedQuantity: "18" },
            ],
          },
        },
      });
      ids.push(id);
    }

    return { dough, ids };
  }

  const idsOf = (response: { json: () => { items: { id: string }[] } }) => response.json().items.map(({ id }) => id);

  it("lists the pre-weighings, the newest first, each as it was recorded", async () => {
    const { headers, userId } = await canRead();
    const { ids } = await recordThree(userId);

    const response = await listPreWeighings(headers);

    expect(response.statusCode).toBe(200);
    expect(idsOf(response)).toEqual([ids[2], ids[1], ids[0]]);
    expect(response.json().nextCursor).toBeNull();
    expect(response.json().items[0]).toEqual((await getPreWeighing(headers, ids[2]!)).json());
  });

  // A production in progress (or finished) whose one item the pre-weighing guides.
  const guideWith = (userId: string, productSku: string, preWeighingId: string, status: "PENDING" | "FINISHED") =>
    testPrisma.production.create({
      data: {
        createdById: userId,
        items: { create: [{ productSku, preWeighingId, expectedQuantity: "50", status }] },
      },
    });

  const damage = async (userId: string, productSku: string, preWeighingId: string) => {
    const production = await testPrisma.production.create({
      data: { createdById: userId, items: { create: [{ productSku, expectedQuantity: "50" }] } },
      include: { items: true },
    });
    const reason = await testPrisma.lossReason.create({ data: { name: "Burnt" } });

    return testPrisma.productionItemDamage.create({
      data: { productionItemId: production.items[0]!.id, preWeighingId, reasonId: reason.id, createdById: userId },
    });
  };

  it("lists only the pre-weighings of the status asked for", async () => {
    const { headers, userId } = await canRead();
    const { dough, ids } = await recordThree(userId);
    const { id: damagedId } = await testPrisma.preWeighing.create({
      data: { productSku: dough.sku, quantity: "50", createdById: userId, createdAt: new Date("2026-10-04T12:00:00Z") },
    });
    await guideWith(userId, dough.sku, ids[1]!, "PENDING");
    await guideWith(userId, dough.sku, ids[2]!, "FINISHED");
    await damage(userId, dough.sku, damagedId);

    expect(idsOf(await listPreWeighings(headers, { status: "PENDING" }))).toEqual([ids[0]]);
    expect(idsOf(await listPreWeighings(headers, { status: "IN_PRODUCTION" }))).toEqual([ids[1]]);
    expect(idsOf(await listPreWeighings(headers, { status: "PRODUCED" }))).toEqual([ids[2]]);
    expect(idsOf(await listPreWeighings(headers, { status: "DAMAGED" }))).toEqual([damagedId]);
  });

  // Links a pre-weighing to an item as one of its extra weighings.
  const linkExtra = async (
    userId: string,
    productSku: string,
    preWeighingId: string,
    status: "PENDING" | "FINISHED",
  ) => {
    const production = await guideWith(userId, productSku, (await recordFree(userId, productSku)).id, status);
    const item = await testPrisma.productionItem.findFirstOrThrow({ where: { productionId: production.id } });

    await testPrisma.productionItemWeighing.create({ data: { productionItemId: item.id, preWeighingId } });
  };

  const recordFree = (userId: string, productSku: string) =>
    testPrisma.preWeighing.create({ data: { productSku, quantity: "50", createdById: userId } });

  it("reads a pre-weighing taken as an extra weighing like one that guides an item", async () => {
    const { headers, userId } = await canRead();
    const { dough, ids } = await recordThree(userId);
    await linkExtra(userId, dough.sku, ids[0]!, "PENDING");
    await linkExtra(userId, dough.sku, ids[1]!, "FINISHED");

    expect((await getPreWeighing(headers, ids[0]!)).json()).toMatchObject({ status: "IN_PRODUCTION" });
    expect((await getPreWeighing(headers, ids[1]!)).json()).toMatchObject({ status: "PRODUCED" });
    expect((await getPreWeighing(headers, ids[2]!)).json()).toMatchObject({ status: "PENDING" });
    expect(idsOf(await listPreWeighings(headers, { status: "IN_PRODUCTION" }))).toContain(ids[0]);
    expect(idsOf(await listPreWeighings(headers, { status: "PRODUCED" }))).toContain(ids[1]);
    expect(idsOf(await listPreWeighings(headers, { status: "PENDING" }))).not.toContain(ids[0]);
  });

  it("lists as stale only a pending pre-weighing older than 48 hours", async () => {
    const { headers, userId } = await canRead();
    const { dough, ids } = await recordThree(userId);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    await testPrisma.preWeighing.update({ where: { id: ids[0]! }, data: { createdAt: threeDaysAgo } });
    await testPrisma.preWeighing.update({ where: { id: ids[1]! }, data: { createdAt: threeDaysAgo } });
    await testPrisma.preWeighing.update({ where: { id: ids[2]! }, data: { createdAt: new Date() } });
    await guideWith(userId, dough.sku, ids[1]!, "FINISHED");

    expect(idsOf(await listPreWeighings(headers, { staleOnly: "true" }))).toEqual([ids[0]]);
  });

  it("counts the stale pending pre-weighings", async () => {
    const { headers, userId } = await canRead();
    const { dough, ids } = await recordThree(userId);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    await testPrisma.preWeighing.update({ where: { id: ids[0]! }, data: { createdAt: threeDaysAgo } });
    await testPrisma.preWeighing.update({ where: { id: ids[1]! }, data: { createdAt: threeDaysAgo } });
    await testPrisma.preWeighing.update({ where: { id: ids[2]! }, data: { createdAt: new Date() } });
    await guideWith(userId, dough.sku, ids[1]!, "FINISHED");

    const response = await inject(staleCount, { method: "GET", url: "/v1/pre-weighings/stale-count", headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ count: 1 });
  });

  it("answers 403 to the stale count without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect(
      (await inject(staleCount, { method: "GET", url: "/v1/pre-weighings/stale-count", headers })).statusCode,
    ).toBe(403);
  });

  it("answers 401 to the stale count without a token", async () => {
    expect(
      (await inject(staleCount, { method: "GET", url: "/v1/pre-weighings/stale-count", headers: undefined }))
        .statusCode,
    ).toBe(401);
  });

  it("hands the list out in pages, each pointing to the next", async () => {
    const { headers, userId } = await canRead();
    const { ids } = await recordThree(userId);

    const page = await listPreWeighings(headers, { limit: "2" });

    expect(idsOf(page)).toEqual([ids[2], ids[1]]);
    expect(page.json().nextCursor).toBe(ids[1]);

    const next = await listPreWeighings(headers, { limit: "2", cursor: page.json().nextCursor });

    expect(idsOf(next)).toEqual([ids[0]]);
    expect(next.json().nextCursor).toBeNull();
  });

  it.each([
    ["a zero limit", { limit: "0" }],
    ["a limit above a hundred", { limit: "101" }],
    ["a cursor that is not an id", { cursor: "next" }],
    ["a status that does not exist", { status: "MAYBE" }],
    ["the removed availability filter", { available: "true" }],
    ["a stale filter that is not true", { staleOnly: "false" }],
  ])("answers 400 for %s", async (_label, query: Record<string, string>) => {
    const { headers } = await canRead();

    expect((await listPreWeighings(headers, query)).statusCode).toBe(400);
  });

  it("answers 403 without PRODUCTION_READ", async () => {
    const { headers } = await canCreate();

    expect((await listPreWeighings(headers)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await listPreWeighings(undefined)).statusCode).toBe(401);
  });
});

type Skus = { flour: string; water: string; salt: string };

describe("DELETE /v1/pre-weighings/:id", () => {
  // A dough weighed for itself, and a complement of water recorded under it.
  async function doughTree(userId: string) {
    const { dough, flour, water } = await createDough();
    const root = await testPrisma.preWeighing.create({
      data: {
        productSku: dough.sku,
        quantity: "50",
        createdById: userId,
        items: { create: [{ productSku: flour.sku, plannedQuantity: "30", weighedQuantity: "30" }] },
      },
    });
    const child = await testPrisma.preWeighing.create({
      data: {
        productSku: dough.sku,
        quantity: "25",
        createdById: userId,
        parentId: root.id,
        items: { create: [{ productSku: water.sku, plannedQuantity: "9", weighedQuantity: "9" }] },
      },
    });

    return { dough, root, child };
  }

  // A production in progress whose one item the pre-weighing guides.
  const guide = (userId: string, productSku: string, preWeighingId: string) =>
    testPrisma.production.create({
      data: { createdById: userId, items: { create: [{ productSku, preWeighingId, expectedQuantity: "1" }] } },
    });

  const canDelete = () => authenticateAs([Permission.PRODUCTION_READ, Permission.PRODUCTION_CREATE]);

  it("deletes a pending pre-weighing with the ones recorded under it", async () => {
    const { headers, userId } = await canDelete();
    const { root } = await doughTree(userId);

    const response = await deletePreWeighing(headers, root.id);

    expect(response.statusCode).toBe(204);
    expect(await testPrisma.preWeighing.count()).toBe(0);
    expect(await testPrisma.preWeighingItem.count()).toBe(0);
  });

  it("deletes a complement and leaves the pre-weighing it complements", async () => {
    const { headers, userId } = await canDelete();
    const { root, child } = await doughTree(userId);

    const response = await deletePreWeighing(headers, child.id);

    expect(response.statusCode).toBe(204);
    expect((await getPreWeighing(headers, root.id)).json()).toMatchObject({ id: root.id, children: [] });
  });

  it("refuses to delete a pre-weighing that guides a production, and deletes nothing", async () => {
    const { headers, userId } = await canDelete();
    const { dough, root } = await doughTree(userId);
    await guide(userId, dough.sku, root.id);

    const response = await deletePreWeighing(headers, root.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The pre-weighing is not pending." });
    expect(await testPrisma.preWeighing.count()).toBe(2);
  });

  it("refuses to delete a damaged pre-weighing, and deletes nothing", async () => {
    const { headers, userId } = await canDelete();
    const { dough, root } = await doughTree(userId);
    const free = await testPrisma.production.create({
      data: { createdById: userId, items: { create: [{ productSku: dough.sku, expectedQuantity: "1" }] } },
      include: { items: true },
    });
    const reason = await testPrisma.lossReason.create({ data: { name: "Burnt" } });
    await testPrisma.productionItemDamage.create({
      data: { productionItemId: free.items[0]!.id, preWeighingId: root.id, reasonId: reason.id, createdById: userId },
    });

    const response = await deletePreWeighing(headers, root.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: "The pre-weighing is not pending." });
    expect(await testPrisma.preWeighing.count()).toBe(2);
  });

  it("refuses to delete a pre-weighing when one recorded under it guides a production", async () => {
    const { headers, userId } = await canDelete();
    const { dough, root, child } = await doughTree(userId);
    await guide(userId, dough.sku, child.id);

    const response = await deletePreWeighing(headers, root.id);

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.preWeighing.count()).toBe(2);
  });

  it("deletes a pre-weighing whose production was canceled", async () => {
    const { headers, userId } = await canDelete();
    const { dough, child } = await doughTree(userId);
    await guide(userId, dough.sku, child.id);
    await testPrisma.productionItem.updateMany({ data: { preWeighingId: null } });

    expect((await deletePreWeighing(headers, child.id)).statusCode).toBe(204);
  });

  it("presents each status of a pre-weighing", async () => {
    const { headers, userId } = await canDelete();
    const { dough, root, child } = await doughTree(userId);
    const [finished, damaged] = await Promise.all(
      ["finished", "damaged"].map(() =>
        testPrisma.preWeighing.create({ data: { productSku: dough.sku, quantity: "5", createdById: userId } }),
      ),
    );
    await guide(userId, dough.sku, child.id);
    await testPrisma.production.create({
      data: {
        createdById: userId,
        items: {
          create: [{ productSku: dough.sku, preWeighingId: finished!.id, expectedQuantity: "1", status: "FINISHED" }],
        },
      },
    });
    const free = await testPrisma.production.create({
      data: { createdById: userId, items: { create: [{ productSku: dough.sku, expectedQuantity: "1" }] } },
      include: { items: true },
    });
    const reason = await testPrisma.lossReason.create({ data: { name: "Burnt" } });
    await testPrisma.productionItemDamage.create({
      data: {
        productionItemId: free.items[0]!.id,
        preWeighingId: damaged!.id,
        reasonId: reason.id,
        createdById: userId,
      },
    });

    expect((await getPreWeighing(headers, root.id)).json()).toMatchObject({ status: "PENDING" });
    expect((await getPreWeighing(headers, child.id)).json()).toMatchObject({ status: "IN_PRODUCTION" });
    expect((await getPreWeighing(headers, finished!.id)).json()).toMatchObject({ status: "PRODUCED" });
    expect((await getPreWeighing(headers, damaged!.id)).json()).toMatchObject({ status: "DAMAGED" });
  });

  it("answers 404 for a pre-weighing that does not exist", async () => {
    const { headers } = await canDelete();

    expect((await deletePreWeighing(headers, MISSING_ID)).statusCode).toBe(404);
  });

  it("answers 403 without PRODUCTION_CREATE", async () => {
    const { headers } = await canRead();

    expect((await deletePreWeighing(headers, MISSING_ID)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await deletePreWeighing(undefined, MISSING_ID)).statusCode).toBe(401);
  });
});

describe("GET /v1/pre-weighings/start-candidates", () => {
  type Candidate = { id: string; status: string; product: { sku: string }; stages: Candidate[] };

  const getCandidates = (headers: Headers) =>
    inject(startCandidates, { method: "GET", url: "/v1/pre-weighings/start-candidates", headers });

  // A bonbon weighed with its filling and its shell recorded under it.
  async function recordBonbon(userId: string) {
    const { bonbon, filling, shell, chocolate } = await createBonbon();
    const record = (productSku: string, quantity: string, parentId: string | null, createdAt: string) =>
      testPrisma.preWeighing.create({
        data: {
          productSku,
          quantity,
          createdById: userId,
          parentId,
          createdAt: new Date(createdAt),
          items: { create: [{ productSku: chocolate.sku, plannedQuantity: "1", weighedQuantity: "1" }] },
        },
      });
    const root = await record(bonbon.sku, "50", null, "2026-10-01T12:00:00Z");
    const fillingStage = await record(filling.sku, "0.7", root.id, "2026-10-01T12:01:00Z");
    const shellStage = await record(shell.sku, "50", root.id, "2026-10-01T12:02:00Z");

    return { bonbon, filling, shell, root, fillingStage, shellStage, record };
  }

  const guide = (userId: string, productSku: string, preWeighingId: string, status: "PENDING" | "FINISHED") =>
    testPrisma.production.create({
      data: {
        createdById: userId,
        items: { create: [{ productSku, preWeighingId, expectedQuantity: "1", status }] },
      },
    });

  it("offers the pending root once, with its stages nested", async () => {
    const { headers, userId } = await canRead();
    const { root, filling, shell } = await recordBonbon(userId);

    const response = await getCandidates(headers);

    expect(response.statusCode).toBe(200);
    const candidates = response.json<Candidate[]>();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe(root.id);
    expect(candidates[0]!.status).toBe("PENDING");
    expect(candidates[0]!.stages.map((stage) => stage.product.sku).sort()).toEqual([filling.sku, shell.sku].sort());
    expect(candidates[0]!.stages.every((stage) => stage.stages.length === 0)).toBe(true);
  });

  it("leaves out a stage that a production already guides", async () => {
    const { headers, userId } = await canRead();
    const { filling, shell, fillingStage } = await recordBonbon(userId);
    await guide(userId, filling.sku, fillingStage.id, "PENDING");

    const candidates = (await getCandidates(headers)).json<Candidate[]>();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.stages.map((stage) => stage.product.sku)).toEqual([shell.sku]);
  });

  it("offers a pending complement of a produced root as a candidate of its own", async () => {
    const { headers, userId } = await canRead();
    const { bonbon, root, record } = await recordBonbon(userId);
    await guide(userId, bonbon.sku, root.id, "FINISHED");
    const complement = await record(bonbon.sku, "5", root.id, "2026-10-02T12:00:00Z");

    const candidates = (await getCandidates(headers)).json<Candidate[]>();

    expect(candidates.map(({ id }) => id)).toContain(complement.id);
    expect(candidates.map(({ id }) => id)).not.toContain(root.id);
  });

  it("lists the newest candidate first", async () => {
    const { headers, userId } = await canRead();
    const { dough, flour } = await createDough();
    const ids: string[] = [];

    for (const day of ["01", "02"]) {
      const { id } = await testPrisma.preWeighing.create({
        data: {
          productSku: dough.sku,
          quantity: "10",
          createdById: userId,
          createdAt: new Date(`2026-10-${day}T12:00:00Z`),
          items: { create: [{ productSku: flour.sku, plannedQuantity: "1", weighedQuantity: "1" }] },
        },
      });
      ids.push(id);
    }

    expect((await getCandidates(headers)).json<Candidate[]>().map(({ id }) => id)).toEqual([ids[1], ids[0]]);
  });

  it("answers an empty list when nothing is pending", async () => {
    const { headers, userId } = await canRead();
    const { bonbon, root, filling, fillingStage, shell, shellStage } = await recordBonbon(userId);
    await guide(userId, bonbon.sku, root.id, "FINISHED");
    await guide(userId, filling.sku, fillingStage.id, "FINISHED");
    await guide(userId, shell.sku, shellStage.id, "FINISHED");

    expect((await getCandidates(headers)).json()).toEqual([]);
  });

  it("answers 403 without PRODUCTION_READ and 401 without a token", async () => {
    const { headers } = await authenticateAs([Permission.PRODUCTION_CREATE]);

    expect((await getCandidates(headers)).statusCode).toBe(403);
    expect((await getCandidates(undefined)).statusCode).toBe(401);
  });

  it("reads a whole tree, the root first and each branch depth-first", async () => {
    const { userId } = await canRead();
    const { root, fillingStage, shellStage, record, bonbon } = await recordBonbon(userId);
    const grandchild = await record(bonbon.sku, "1", fillingStage.id, "2026-10-01T12:03:00Z");

    const tree = await findPreWeighingTree(root.id);
    const filling = [fillingStage.id, grandchild.id];
    const expected = fillingStage.id < shellStage.id ? [...filling, shellStage.id] : [shellStage.id, ...filling];

    expect(tree.map(({ id }) => id)).toEqual([root.id, ...expected]);
  });
});
