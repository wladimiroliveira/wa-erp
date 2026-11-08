import { describe, expect, it } from "vitest";
import { roundToCents } from "./fixed-point";

describe("roundToCents", () => {
  it.each([
    ["11.842105", "11.84"],
    ["11.845", "11.85"],
    ["5", "5.00"],
    ["0.004999", "0.00"],
  ])("%s is %s", (value, expected) => expect(roundToCents(value)).toBe(expected));
});
