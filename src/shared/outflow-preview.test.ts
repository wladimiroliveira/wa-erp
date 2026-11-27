import { describe, expect, it } from "vitest";
import { previewOutflow } from "@/shared/outflow-preview";

describe("previewOutflow", () => {
  it("multiplies the quantity by the price and by the cost, each rounded half up to the cent", () => {
    expect(previewOutflow({ quantity: "3", unitPrice: "13.80", unitCost: "9.20" })).toEqual({
      revenue: "41.40",
      cost: "27.60",
      profit: "13.80",
    });
    expect(previewOutflow({ quantity: "0.5", unitPrice: "0.01", unitCost: "0.03" })).toEqual({
      revenue: "0.01",
      cost: "0.02",
      profit: "-0.01",
    });
  });

  it("has no revenue or profit without a price", () => {
    expect(previewOutflow({ quantity: "2", unitPrice: null, unitCost: "9.20" })).toEqual({
      revenue: null,
      cost: "18.40",
      profit: null,
    });
  });
});
