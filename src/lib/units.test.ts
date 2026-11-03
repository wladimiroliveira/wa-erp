import { describe, expect, it } from "vitest";
import { unitLabel, unitName, UNITS } from "@/lib/units";

describe("unitLabel", () => {
  it("abbreviates a measurement unit the way the shop floor writes it", () => {
    expect(unitLabel("KILOGRAM")).toBe("kg");
    expect(unitLabel("UNIT")).toBe("un");
  });
});

describe("unitName", () => {
  it("spells a measurement unit out, for the form that asks the operator to choose one", () => {
    expect(unitName("KILOGRAM")).toBe("Quilograma (kg)");
    expect(UNITS.map(unitName)).toHaveLength(5);
  });
});
