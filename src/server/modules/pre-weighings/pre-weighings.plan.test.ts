import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { planQuantity, suggestQuantities, type Suggestion } from "@/server/modules/pre-weighings/pre-weighings.plan";

const plan = (recipeQuantity: string, yieldQuantity: string, quantity: string) =>
  planQuantity({ recipeQuantity, yieldQuantity, quantity })?.toString() ?? null;

describe("planQuantity", () => {
  it("scales the quantity of the recipe by how much is to be produced", () => {
    expect(plan("15", "25", "50")).toBe("30");
    expect(plan("15", "25", "5")).toBe("3");
    expect(plan("15", "25", "25")).toBe("15");
  });

  it("rounds to the six decimal places a quantity holds", () => {
    expect(plan("1", "3", "1")).toBe("0.333333");
    expect(plan("2", "3", "1")).toBe("0.666667");
  });

  it("does not lose a cent of precision the way a float would", () => {
    expect(plan("0.1", "1", "3")).toBe("0.3");
  });

  it("gives no plan for a quantity too small to weigh", () => {
    expect(plan("0.000001", "1000", "1")).toBeNull();
  });

  it("gives no plan for a quantity too large to store", () => {
    expect(plan("999999999999", "0.000001", "999999999999")).toBeNull();
  });
});

describe("suggestQuantities", () => {
  const D = (value: string) => new Prisma.Decimal(value);
  type Unit = "KILOGRAM" | "GRAM" | "LITER" | "MILLILITER" | "UNIT";
  const MILK = { sku: "sku-milk", description: "Leite condensado", unit: "GRAM" as Unit };
  const CREAM = { sku: "sku-cream", description: "Creme de leite", unit: "MILLILITER" as Unit };

  const milk = (recipeQuantity: string, averageCost: string | null = "0.02") => ({
    product: MILK,
    recipeQuantity: D(recipeQuantity),
    content: D("395"),
    averageCost: averageCost === null ? null : D(averageCost),
  });
  const cream = (recipeQuantity: string, averageCost: string | null) => ({
    product: CREAM,
    recipeQuantity: D(recipeQuantity),
    content: D("1000"),
    averageCost: averageCost === null ? null : D(averageCost),
  });

  const suggest = (
    ingredients: ReturnType<typeof milk>[],
    { quantity = "10", yieldQuantity = "1", unit = "KILOGRAM" as Unit, tolerance = 20 } = {},
  ) => suggestQuantities({ quantity: D(quantity), yieldQuantity: D(yieldQuantity), unit, tolerance, ingredients });

  const read = ({ quantity, loss, leftovers }: Suggestion) => ({
    quantity: quantity.toString(),
    loss: loss.toFixed(2),
    leftovers: leftovers.map((left) => ({
      sku: left.product.sku,
      leftover: left.leftover.toString(),
      loss: left.loss?.toFixed(2) ?? null,
    })),
  });

  it("offers nothing when the quantity asked for already uses whole packagings", () => {
    const { requested, alternatives } = suggest([milk("395")]);

    expect(read(requested)).toEqual({ quantity: "10", loss: "0.00", leftovers: [] });
    expect(alternatives).toEqual([]);
  });

  it("prices the leftover of the quantity asked for, and offers the one that closes the cans", () => {
    const { requested, alternatives } = suggest([milk("300")]);

    expect(read(requested)).toEqual({
      quantity: "10",
      loss: "3.20",
      leftovers: [{ sku: MILK.sku, leftover: "160", loss: "3.20" }],
    });
    expect(read(alternatives[0]!)).toEqual({
      quantity: "10.533",
      loss: "0.00",
      leftovers: [{ sku: MILK.sku, leftover: "0.1", loss: "0.00" }],
    });
    expect(alternatives.map(({ quantity }) => quantity.toString())).not.toContain("10.534");
  });

  it("ranks by the money lost on every ingredient", () => {
    const { requested, alternatives } = suggest([milk("300"), cream("250", "0.01")]);

    expect(requested.loss.toFixed(2)).toBe("8.20");
    expect(alternatives.map((suggestion) => [suggestion.quantity.toString(), suggestion.loss.toFixed(2)])).toEqual([
      ["11.85", "0.38"],
      ["10.533", "3.67"],
      ["12", "7.00"],
    ]);
    for (const { quantity } of alternatives) {
      expect(quantity.gt(10) && quantity.lte(12)).toBe(true);
    }
  });

  it("lists the leftover of an ingredient with no average cost, out of the sum", () => {
    const { requested } = suggest([milk("300"), cream("250", null)]);

    expect(read(requested)).toEqual({
      quantity: "10",
      loss: "3.20",
      leftovers: [
        { sku: MILK.sku, leftover: "160", loss: "3.20" },
        { sku: CREAM.sku, leftover: "500", loss: null },
      ],
    });
  });

  it("offers only whole units of a product counted in units", () => {
    const { alternatives } = suggest([milk("300")], { quantity: "9", yieldQuantity: "4", unit: "UNIT" });

    expect(alternatives.map(read)).toEqual([
      { quantity: "10", loss: "0.80", leftovers: [{ sku: MILK.sku, leftover: "40", loss: "0.80" }] },
    ]);
  });

  it("puts the smaller quantity first when two lose the same", () => {
    // Cans of 400 g at 300 g per kg close at 12 kg, the very limit, and almost close at 10,666 kg:
    // at a cost this low both lose R$ 0,00.
    const cheap = { ...milk("300", "0.0001"), content: D("400") };

    const { alternatives } = suggest([cheap]);

    expect(alternatives.map((suggestion) => [suggestion.quantity.toString(), suggestion.loss.toFixed(2)])).toEqual([
      ["10.666", "0.00"],
      ["12", "0.00"],
    ]);
  });

  it("writes every leftover as the 6-place decimal the plan weighs, never in exponent notation", () => {
    const sugar = { ...milk("1.810436", "1"), product: { ...MILK, unit: "KILOGRAM" as Unit }, content: D("0.085") };

    const { requested, alternatives } = suggest([sugar], { quantity: "2.065", yieldQuantity: "4.887" });

    for (const { leftovers } of [requested, ...alternatives]) {
      for (const { leftover } of leftovers) expect(leftover.toString()).toMatch(/^\d+(\.\d{1,6})?$/);
    }
  });

  it("offers nothing with no tolerance", () => {
    expect(suggest([milk("300")], { tolerance: 0 }).alternatives).toEqual([]);
  });

  it("leaves out an ingredient whose packaging holds nothing, instead of dividing by zero", () => {
    const { requested, alternatives } = suggest([{ ...milk("300"), content: D("0") }]);

    expect(read(requested)).toEqual({ quantity: "10", loss: "0.00", leftovers: [] });
    expect(alternatives).toEqual([]);
  });

  it("stays bounded with a wide tolerance and a tiny packaging", () => {
    const tiny = { ...milk("1.5"), content: D("1") };

    const { alternatives } = suggest([tiny], { quantity: "1000", tolerance: 100 });

    expect(alternatives.length).toBeLessThanOrEqual(3);
  });
});
