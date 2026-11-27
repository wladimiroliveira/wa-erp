import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  findCurrentPrice,
  findPricingInputs,
  findPricingSources,
  insertPrice,
  upsertMarkup,
} from "@/server/modules/pricing/pricing.repository";
import { setMarkup } from "@/server/modules/pricing/pricing.service";
import { resetDatabase, testPrisma } from "@/server/testing/database";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const aUser = (username: string) => testPrisma.user.create({ data: { name: username, username, passwordHash: "x" } });

async function aManufactured(description: string, isActive = true) {
  return testPrisma.product.create({ data: { description, kind: "MANUFACTURED", unit: "UNIT", isActive } });
}

describe("findPricingSources", () => {
  it("lists active manufactured products with markup and prices, newest first, at most 20", async () => {
    await testPrisma.product.create({ data: { description: "Farinha", kind: "GOODS", unit: "KILOGRAM" } });
    const bread = await aManufactured("Pão francês");
    await aManufactured("Pão antigo", false);
    const cake = await aManufactured("Bolo sem receita");
    const ana = await aUser("ana");
    await upsertMarkup({ productSku: bread.sku, markupPercent: "35", updatedById: ana.id });
    for (let index = 0; index < 22; index += 1) {
      await insertPrice(testPrisma, {
        productSku: bread.sku,
        averageCost: "1",
        markupPercent: "35",
        price: `${index + 2}.00`,
      });
    }

    const sources = await findPricingSources();

    expect(sources.map(({ sku }) => sku)).toEqual([cake.sku, bread.sku]);
    expect(sources[0]).toMatchObject({ markup: null, prices: [] });
    expect(sources[1]?.markup?.markupPercent.toString()).toBe("35");
    expect(sources[1]?.prices).toHaveLength(20);
    expect(sources[1]?.prices[0]?.price.toString()).toBe("23");
  });
});

describe("upsertMarkup", () => {
  it("creates then updates, recording the user", async () => {
    const bread = await aManufactured("Pão francês");
    const ana = await aUser("ana");
    const bia = await aUser("bia");

    await upsertMarkup({ productSku: bread.sku, markupPercent: "35", updatedById: ana.id });
    await upsertMarkup({ productSku: bread.sku, markupPercent: "40.5", updatedById: bia.id });

    const stored = await testPrisma.productMarkup.findUniqueOrThrow({ where: { productSku: bread.sku } });

    expect(stored.markupPercent.toString()).toBe("40.5");
    expect(stored.updatedById).toBe(bia.id);
  });
});

describe("findPricingInputs", () => {
  it("answers the kind and markup, null for an unknown product", async () => {
    const bread = await aManufactured("Pão francês");
    const ana = await aUser("ana");

    expect(await findPricingInputs(testPrisma, bread.sku)).toEqual({ kind: "MANUFACTURED", markupPercent: null });

    await upsertMarkup({ productSku: bread.sku, markupPercent: "35", updatedById: ana.id });

    expect((await findPricingInputs(testPrisma, bread.sku))?.markupPercent?.toString()).toBe("35");
    expect(await findPricingInputs(testPrisma, "018f0000-0000-7000-8000-0000000000ff")).toBeNull();
  });
});

describe("insertPrice and findCurrentPrice", () => {
  it("finds the latest price, null while there is none", async () => {
    const bread = await aManufactured("Pão francês");

    expect(await findCurrentPrice(testPrisma, bread.sku)).toBeNull();

    await insertPrice(testPrisma, { productSku: bread.sku, averageCost: "1.5", markupPercent: "50.00", price: "2.25" });
    await insertPrice(testPrisma, { productSku: bread.sku, averageCost: "2", markupPercent: "50.00", price: "3.00" });

    const current = await findCurrentPrice(testPrisma, bread.sku);

    expect(current?.price.toString()).toBe("3");
    expect(current?.averageCost.toString()).toBe("2");
  });
});

describe("setMarkup pricing", () => {
  async function aBreadOnHand() {
    const bread = await aManufactured("Pão francês");
    await testPrisma.stockLot.create({
      data: { productSku: bread.sku, quantity: "10", initialQuantity: "10", unitCost: "4" },
    });

    return bread;
  }

  it("writes the first price when the first markup is set", async () => {
    const bread = await aBreadOnHand();
    const ana = await aUser("ana");

    await setMarkup(ana.id, { productSku: bread.sku, markupPercent: "50" });

    const prices = await testPrisma.productPrice.findMany({ where: { productSku: bread.sku } });

    expect(prices).toHaveLength(1);
    expect(prices[0]?.price.toString()).toBe("6");
  });

  it("leaves the prices as they are when the markup changes after one exists", async () => {
    const bread = await aBreadOnHand();
    const ana = await aUser("ana");

    await setMarkup(ana.id, { productSku: bread.sku, markupPercent: "50" });
    await setMarkup(ana.id, { productSku: bread.sku, markupPercent: "80" });

    const prices = await testPrisma.productPrice.findMany({ where: { productSku: bread.sku } });

    expect(prices).toHaveLength(1);
    expect(prices[0]?.markupPercent.toString()).toBe("50");
  });
});
