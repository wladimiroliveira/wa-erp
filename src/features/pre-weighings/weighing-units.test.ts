import { describe, expect, it } from "vitest";
import { weighedOf } from "@/features/pre-weighings/weighing-units";

describe("weighedOf", () => {
  it("writes a quantity in the unit shown", () => expect(weighedOf("0.25", "KILOGRAM", "GRAM")).toBe("250 g"));
  it("writes millilitres as litres", () => expect(weighedOf("1500", "MILLILITER", "LITER")).toBe("1,5 L"));
  it("rounds half up to 3 places in the unit shown", () =>
    expect(weighedOf("0.0123456", "KILOGRAM", "GRAM")).toBe("12,346 g"));
  it("keeps 3 places of a kilogram", () => expect(weighedOf("0.0123456", "KILOGRAM", "KILOGRAM")).toBe("0,012 kg"));
  it("keeps a unit as it is", () => expect(weighedOf("3", "UNIT", "UNIT")).toBe("3 un"));
});
