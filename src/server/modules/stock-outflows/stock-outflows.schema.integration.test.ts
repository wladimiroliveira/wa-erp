import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "@/server/testing/database";

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let productSku: string;
let createdById: string;

beforeEach(async () => {
  const user = await testPrisma.user.create({ data: { name: "Operator", username: "operator", passwordHash: "x" } });
  const product = await testPrisma.product.create({
    data: { description: "Bread", kind: "GOODS", unit: "UNIT" },
  });
  createdById = user.id;
  productSku = product.sku;
});

const outflow = (data: { kind: "SALE" | "DONATION"; listPrice?: string; unitPrice?: string }) =>
  testPrisma.stockOutflow.create({ data: { quantity: "1", productSku, createdById, ...data } });

describe("stock_outflows prices by kind", () => {
  it("rejects a sale without a unit price", async () => {
    await expect(outflow({ kind: "SALE", listPrice: "10.00" })).rejects.toThrow(/ck_stock_outflows_prices_by_kind/);
  });

  it("rejects a sale without a list price", async () => {
    await expect(outflow({ kind: "SALE", unitPrice: "9.00" })).rejects.toThrow(/ck_stock_outflows_prices_by_kind/);
  });

  it("rejects a donation that carries a unit price", async () => {
    await expect(outflow({ kind: "DONATION", unitPrice: "1.00" })).rejects.toThrow(/ck_stock_outflows_prices_by_kind/);
  });

  it("rejects a donation that carries a list price", async () => {
    await expect(outflow({ kind: "DONATION", listPrice: "1.00" })).rejects.toThrow(/ck_stock_outflows_prices_by_kind/);
  });

  it("accepts a sale with both prices and a donation with neither", async () => {
    await expect(outflow({ kind: "SALE", listPrice: "10.00", unitPrice: "9.00" })).resolves.toBeTruthy();
    await expect(outflow({ kind: "DONATION" })).resolves.toBeTruthy();
  });
});
