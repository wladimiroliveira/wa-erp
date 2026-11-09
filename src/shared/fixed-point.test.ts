import { describe, expect, it } from "vitest";
import { roundHalfUp, roundToCents } from "./fixed-point";

describe("roundToCents", () => {
  it.each([
    ["11.842105", "11.84"],
    ["11.845", "11.85"],
    ["5", "5.00"],
    ["0.004999", "0.00"],
  ])("%s is %s", (value, expected) => expect(roundToCents(value)).toBe(expected));
});

describe("roundHalfUp", () => {
  it.each([
    ["12.3456", 3, "12.346"],
    ["12.3454", 3, "12.345"],
    ["0.0005", 3, "0.001"],
    ["0.000499999999", 3, "0.000"],
    ["250", 3, "250.000"],
    ["0.012345678", 3, "0.012"],
  ])("%s to %i places is %s", (value, places, expected) => expect(roundHalfUp(value, places)).toBe(expected));
});
