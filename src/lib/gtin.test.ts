import { describe, expect, it } from "vitest";
import { hasValidCheckDigit } from "@/lib/gtin";

describe("gtin", () => {
  it.each(["73513537", "036000291452", "7891000100103", "17891000100100"])(
    "takes %s, whose last digit checks the others",
    (code) => {
      expect(hasValidCheckDigit(code)).toBe(true);
    },
  );

  it.each(["73513538", "7891000100104", "7891000101003"])("refuses %s, mistyped", (code) => {
    expect(hasValidCheckDigit(code)).toBe(false);
  });
});
