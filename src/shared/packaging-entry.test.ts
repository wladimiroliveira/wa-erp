import { describe, expect, it } from "vitest";
import { moneySchema } from "./decimal";
import { packagedQuantity, packageUnitCost } from "./packaging-entry";

describe("packageUnitCost", () => {
  it.each([
    ["4.50", "0.38", "11.842105"],
    ["10.00", "2", "5.000000"],
    ["0.01", "20000", "0.000001"],
    ["0.01", "30000", "0.000000"],
  ])("R$ %s for a packaging of %s costs %s per unit, half up at 6 places", (price, content, expected) => {
    expect(packageUnitCost(price, content)).toBe(expected);
  });
});

describe("packagedQuantity", () => {
  it.each<[string, number, string]>([
    ["0.38", 10, "3.8"],
    ["1", 12, "12"],
    ["0.000001", 3, "0.000003"],
  ])("%s times %d packagings is %s", (content, count, expected) => {
    expect(packagedQuantity(content, count)).toBe(expected);
  });
});

describe("moneySchema", () => {
  it.each(["4.5", "4.50", "0"])("takes %s", (value) => expect(moneySchema.safeParse(value).success).toBe(true));

  it.each(["4.505", "-1", "4,50"])("refuses %s", (value) => expect(moneySchema.safeParse(value).success).toBe(false));
});
