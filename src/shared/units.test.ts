import { describe, expect, it } from "vitest";
import type { MeasurementUnit } from "./enums";
import { compatibleUnits, convert, costPerReadableUnit, IncompatibleUnitsError, readableQuantity } from "./units";

describe("convert", () => {
  it.each<[string, MeasurementUnit, MeasurementUnit, string]>([
    ["380", "GRAM", "KILOGRAM", "0.38"],
    ["1.01", "KILOGRAM", "GRAM", "1010"],
    ["250", "MILLILITER", "LITER", "0.25"],
    ["2", "LITER", "MILLILITER", "2000"],
    ["12", "UNIT", "UNIT", "12"],
    ["1.5", "KILOGRAM", "KILOGRAM", "1.5"],
  ])("%s %s in %s is %s", (quantity, from, to, expected) => {
    expect(convert(quantity, from, to)).toBe(expected);
  });

  it("keeps every digit instead of rounding", () => {
    expect(convert("0.0005", "GRAM", "KILOGRAM")).toBe("0.0000005");
  });

  it("refuses units of different dimensions", () => {
    expect(() => convert("1", "KILOGRAM", "LITER")).toThrow(IncompatibleUnitsError);
    expect(() => convert("1", "UNIT", "GRAM")).toThrow(IncompatibleUnitsError);
  });
});

describe("compatibleUnits", () => {
  it("lists the units of the same dimension, the larger first", () => {
    expect(compatibleUnits("GRAM")).toEqual(["KILOGRAM", "GRAM"]);
    expect(compatibleUnits("KILOGRAM")).toEqual(["KILOGRAM", "GRAM"]);
    expect(compatibleUnits("MILLILITER")).toEqual(["LITER", "MILLILITER"]);
    expect(compatibleUnits("UNIT")).toEqual(["UNIT"]);
  });
});

describe("readableQuantity", () => {
  it.each<[string, MeasurementUnit, { quantity: string; unit: MeasurementUnit }]>([
    ["0.38", "KILOGRAM", { quantity: "380", unit: "GRAM" }],
    ["1.5", "KILOGRAM", { quantity: "1.5", unit: "KILOGRAM" }],
    ["1", "KILOGRAM", { quantity: "1", unit: "KILOGRAM" }],
    ["1010", "GRAM", { quantity: "1.01", unit: "KILOGRAM" }],
    ["500", "MILLILITER", { quantity: "500", unit: "MILLILITER" }],
    ["0.250000", "LITER", { quantity: "250", unit: "MILLILITER" }],
    ["12", "UNIT", { quantity: "12", unit: "UNIT" }],
  ])("%s %s reads best as %o", (quantity, unit, expected) => {
    expect(readableQuantity(quantity, unit)).toEqual(expected);
  });
});

describe("costPerReadableUnit", () => {
  it.each<[string, MeasurementUnit, string, MeasurementUnit]>([
    ["0.03398", "GRAM", "33.98", "KILOGRAM"],
    ["0.0045", "MILLILITER", "4.5", "LITER"],
    ["0.000001", "GRAM", "0.001", "KILOGRAM"],
    ["0", "GRAM", "0", "KILOGRAM"],
    ["12.5", "KILOGRAM", "12.5", "KILOGRAM"],
    ["3", "LITER", "3", "LITER"],
    ["2.75", "UNIT", "2.75", "UNIT"],
  ])("reads a cost of %s per %s as %s per %s", (cost, unit, expected, expectedUnit) =>
    expect(costPerReadableUnit(cost, unit)).toEqual({ cost: expected, unit: expectedUnit }),
  );
});
