import { afterAll, afterEach, describe, expect, it } from "vitest";
import { findPricingSources, upsertMarkup } from "@/server/modules/pricing/pricing.repository";
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
  it("lists only active manufactured products with a recipe, with ingredient costs", async () => {
    const flour = await testPrisma.product.create({
      data: { description: "Farinha", kind: "GOODS", unit: "KILOGRAM" },
    });
    await testPrisma.productStock.create({
      data: { productSku: flour.sku, quantity: "10", averageCost: "5.5", lastEntryCost: "6" },
    });
    const bread = await aManufactured("Pão francês");
    const retired = await aManufactured("Pão antigo", false);
    await aManufactured("Bolo sem receita");
    for (const product of [bread, retired]) {
      await testPrisma.recipe.create({
        data: {
          productSku: product.sku,
          yieldQuantity: "10",
          ingredients: { create: [{ productSku: flour.sku, quantity: "2" }] },
        },
      });
    }

    const sources = await findPricingSources();

    expect(sources).toHaveLength(1);
    expect(sources[0]?.product).toMatchObject({ sku: bread.sku, markup: null });
    expect(sources[0]?.ingredients[0]?.product.stock?.averageCost?.toString()).toBe("5.5");
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
