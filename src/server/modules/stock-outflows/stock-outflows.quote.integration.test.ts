import { afterAll, afterEach, describe, expect, it } from "vitest";
import { outflowQuote } from "@/server/modules/stock-outflows/stock-outflows.service";
import { resetDatabase, testPrisma } from "@/server/testing/database";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function product(price: string | null) {
  const created = await testPrisma.product.create({
    data: { description: "Bread", kind: "MANUFACTURED", unit: "UNIT" },
  });

  if (price !== null) {
    await testPrisma.productPrice.create({
      data: { productSku: created.sku, price, averageCost: "8", markupPercent: "50" },
    });
  }

  return created;
}

const lot = (productSku: string, quantity: string, unitCost: string, expiresAt: string | null = null) =>
  testPrisma.stockLot.create({
    data: {
      productSku,
      quantity,
      initialQuantity: quantity,
      unitCost,
      expiresAt: expiresAt === null ? null : new Date(expiresAt),
    },
  });

describe("outflowQuote", () => {
  it("gives the list price, the weighted cost and the quantity of the unexpired lots", async () => {
    const bread = await product("13.80");
    await lot(bread.sku, "2", "10", "2099-01-01");
    await lot(bread.sku, "6", "6");
    await lot(bread.sku, "9", "1", "2000-01-01");

    expect(await outflowQuote(bread.sku)).toEqual({ listPrice: "13.80", onHandCost: "7", available: "8" });
  });

  it("answers no price and no cost for a product without a price or lots", async () => {
    const bread = await product(null);

    expect(await outflowQuote(bread.sku)).toEqual({ listPrice: null, onHandCost: null, available: "0" });
  });
});
