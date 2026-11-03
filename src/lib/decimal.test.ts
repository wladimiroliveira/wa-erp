import { describe, expect, it } from "vitest";
import {
  formatDecimal,
  isDecimalInput,
  maskDecimalInput,
  padDecimalInput,
  stepDecimalInput,
  toApiDecimal,
  toDecimalInput,
} from "@/lib/decimal";

describe("decimal", () => {
  it.each(["10", "10,5", "0,000001", "123456789012", "1.234,5", "123.456.789.012"])(
    "accepts %s as it stands in a field",
    (typed) => {
      expect(isDecimalInput(typed)).toBe(true);
    },
  );

  it.each(["", "ten", "-1", "1,0000001", "1,5,2", "1234567890123", ",", "10.5", "1.2345", "12,"])(
    "refuses %s",
    (typed) => {
      expect(isDecimalInput(typed)).toBe(false);
    },
  );

  it("sends what the field shows as the plain decimal the API expects", () => {
    expect(toApiDecimal("10,5")).toBe("10.5");
    expect(toApiDecimal("1.234.567,5")).toBe("1234567.5");
    expect(toApiDecimal("1.000")).toBe("1000");
  });

  it("writes an API decimal the way the field shows it", () => {
    expect(toDecimalInput("10.5")).toBe("10,5");
    expect(toDecimalInput("1234")).toBe("1.234");
    expect(isDecimalInput(toDecimalInput("1234.000001"))).toBe(true);
  });

  it("shows an API decimal the way it is written in Portuguese", () => {
    expect(formatDecimal("1234.5")).toBe("1.234,5");
    expect(formatDecimal("40")).toBe("40");
    expect(formatDecimal("0.000001")).toBe("0,000001");
  });

  it("keeps at least the asked number of decimal places, for money", () => {
    expect(formatDecimal("5.5", 2)).toBe("5,50");
    expect(formatDecimal("5.555", 2)).toBe("5,555");
  });

  it.each([
    ["10,5", "10,5"],
    ["1234", "1.234"],
    ["1234567,5", "1.234.567,5"],
    ["1.234,5", "1.234,5"],
    ["1.2345", "12.345"],
    ["1a0 kg", "10"],
    ["-3", "3"],
    ["1,5,2", "1,52"],
    ["1234567890123", "123.456.789.012"],
    ["1,1234567", "1,123456"],
    [",5", "0,5"],
    ["007", "7"],
    ["00", "0"],
    ["0,5", "0,5"],
    ["", ""],
  ])("masks %s as %s", (typed, masked) => {
    expect(maskDecimalInput(typed)).toBe(masked);
  });

  it("steps the whole part and leaves the decimals as typed", () => {
    expect(stepDecimalInput("10,5", 1)).toBe("11,5");
    expect(stepDecimalInput("999", 1)).toBe("1.000");
    expect(stepDecimalInput("1.000,25", -1)).toBe("999,25");
    expect(stepDecimalInput("", 1)).toBe("1");
  });

  it("does not step below zero nor past what the API holds", () => {
    expect(stepDecimalInput("0,5", -1)).toBe("0,5");
    expect(stepDecimalInput("", -1)).toBe("");
    expect(stepDecimalInput("999.999.999.999", 1)).toBe("999.999.999.999");
  });

  it("completes the decimal places a finished amount is missing", () => {
    expect(padDecimalInput("12", 2)).toBe("12,00");
    expect(padDecimalInput("1.234,5", 2)).toBe("1.234,50");
    expect(padDecimalInput("12,", 2)).toBe("12,00");
    expect(padDecimalInput("0,0035", 2)).toBe("0,0035");
    expect(padDecimalInput("", 2)).toBe("");
  });
});
