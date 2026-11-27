import { describe, expect, it } from "vitest";
import { priceFor } from "@/shared/pricing";

describe("priceFor", () => {
  it("rounds up to the cent", () => {
    expect(priceFor("1.231", "0")).toBe("1.24");
  });

  it("leaves an exact cent alone", () => {
    expect(priceFor("1.230000", "0")).toBe("1.23");
  });

  it("applies the markup over the cost", () => {
    expect(priceFor("2.000000", "35")).toBe("2.70");
  });

  it("applies a fractional markup", () => {
    expect(priceFor("1.000000", "12.5")).toBe("1.13");
  });

  it("formats a price of one real or more with its whole part", () => {
    expect(priceFor("1234.5", "100")).toBe("2469.00");
  });
});
