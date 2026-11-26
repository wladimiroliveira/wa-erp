import { describe, expect, it } from "vitest";
import {
  hasWeighingPlaces,
  isWeighed,
  toProductUnit,
  weighingUnitOf,
  weighedOf,
} from "@/features/pre-weighings/weighing-units";

describe("weighedOf", () => {
  it("writes a quantity in the unit shown", () => expect(weighedOf("0.25", "KILOGRAM", "GRAM")).toBe("250 g"));
  it("writes millilitres as litres", () => expect(weighedOf("1500", "MILLILITER", "LITER")).toBe("1,5 L"));
  it("rounds half up to 3 places in the unit shown", () =>
    expect(weighedOf("0.0123456", "KILOGRAM", "GRAM")).toBe("12,346 g"));
  it("keeps 3 places of a kilogram", () => expect(weighedOf("0.0123456", "KILOGRAM", "KILOGRAM")).toBe("0,012 kg"));
  it("keeps a unit as it is", () => expect(weighedOf("3", "UNIT", "UNIT")).toBe("3 un"));
});

describe("weighingUnitOf", () => {
  it("picks the unit the planned quantity reads best in", () => {
    expect(weighingUnitOf("KILOGRAM", "0.5")).toBe("GRAM");
    expect(weighingUnitOf("KILOGRAM", "2")).toBe("KILOGRAM");
  });
});

describe("hasWeighingPlaces", () => {
  it("allows up to 3 places", () => {
    expect(hasWeighingPlaces("1,234")).toBe(true);
    expect(hasWeighingPlaces("1,2345")).toBe(false);
  });
});

describe("isWeighed", () => {
  it("takes a positive decimal with up to 3 places", () => {
    expect(isWeighed("510")).toBe(true);
    expect(isWeighed("0")).toBe(false);
    expect(isWeighed("1,2345")).toBe(false);
    expect(isWeighed("abc")).toBe(false);
    expect(isWeighed(undefined)).toBe(false);
  });
});

describe("toProductUnit", () => {
  it("converts what was typed in the shown unit to the product unit as an API decimal", () => {
    expect(toProductUnit("510", "GRAM", "KILOGRAM")).toBe("0.51");
    expect(toProductUnit("1,5", "KILOGRAM", "KILOGRAM")).toBe("1.5");
  });
});
