import { describe, expect, it } from "vitest";
import { amountOf, unitCostOf } from "@/features/stock/stock-format";

describe("unitCostOf", () => {
  it("shows a cost per gram per kilogram", () => expect(unitCostOf("0.03398", "GRAM")).toBe("R$ 33,98/kg"));
  it("shows a cost per millilitre per litre", () => expect(unitCostOf("0.0045", "MILLILITER")).toBe("R$ 4,50/L"));
  it("keeps a cost per unit", () => expect(unitCostOf("4.5", "UNIT")).toBe("R$ 4,50/un"));
  it("shows a dash for no cost", () => expect(unitCostOf(null, "GRAM")).toBe("—"));
});

describe("amountOf", () => {
  it("shows the number alone", () => expect(amountOf("1234.5")).toBe("1.234,5"));
  it("keeps the sign of a negative balance", () => expect(amountOf("-2.5")).toBe("-2,5"));
  it("shows a dash for nothing", () => expect(amountOf(null)).toBe("—"));
});
