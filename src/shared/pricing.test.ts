import { describe, expect, it } from "vitest";
import { costPerUnit, ingredientSubtotal, priceFor } from "@/shared/pricing";

describe("costPerUnit", () => {
  it("sums quantity × average cost and divides by the yield", () => {
    expect(
      costPerUnit({
        yieldQuantity: "10",
        ingredients: [
          { productSku: "a", quantity: "2", averageCost: "5.5" },
          { productSku: "b", quantity: "0.5", averageCost: "8" },
        ],
      }),
    ).toEqual({ status: "complete", costPerUnit: "1.500000" });
  });

  it("is incomplete when any ingredient has no average cost, never partial", () => {
    expect(
      costPerUnit({
        yieldQuantity: "10",
        ingredients: [
          { productSku: "a", quantity: "2", averageCost: "5.5" },
          { productSku: "b", quantity: "1", averageCost: null },
        ],
      }),
    ).toEqual({ status: "incomplete", missing: ["b"] });
  });

  it("keeps 12 places in the product before rounding", () => {
    // 0.333333 × 0.000003 = 0.000000999999, which rounds half-up to 0.000001 at 6 places.
    expect(
      costPerUnit({
        yieldQuantity: "1",
        ingredients: [{ productSku: "a", quantity: "0.333333", averageCost: "0.000003" }],
      }),
    ).toEqual({ status: "complete", costPerUnit: "0.000001" });
  });

  it("is exact where floating point is not", () => {
    expect(
      costPerUnit({
        yieldQuantity: "1",
        ingredients: [
          { productSku: "a", quantity: "1", averageCost: "0.1" },
          { productSku: "b", quantity: "1", averageCost: "0.2" },
        ],
      }),
    ).toEqual({ status: "complete", costPerUnit: "0.300000" });
  });

  it("divides by a fractional yield", () => {
    expect(
      costPerUnit({
        yieldQuantity: "2.5",
        ingredients: [{ productSku: "a", quantity: "1", averageCost: "10" }],
      }),
    ).toEqual({ status: "complete", costPerUnit: "4.000000" });
  });
});

describe("ingredientSubtotal", () => {
  it("multiplies quantity by cost at 6 places", () => {
    expect(ingredientSubtotal("2.5", "1.1")).toBe("2.750000");
  });
});

describe("priceFor", () => {
  it("rounds up to the cent", () => {
    expect(priceFor("1.231", "0")).toBe("1.24");
  });

  it("leaves an exact cent alone", () => {
    expect(priceFor("1.230000", "0")).toBe("1.23");
  });

  it("applies the markup over the cost", () => {
    expect(priceFor("2.000000", "35")).toBe("2.70");
  });

  it("applies a fractional markup", () => {
    expect(priceFor("1.000000", "12.5")).toBe("1.13");
  });

  it("formats a price of one real or more with its whole part", () => {
    expect(priceFor("1234.5", "100")).toBe("2469.00");
  });
});
