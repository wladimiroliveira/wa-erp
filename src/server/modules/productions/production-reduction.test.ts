import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { maxQuantityFromStock } from "@/server/modules/productions/production-reduction";

const D = (v: string) => new Prisma.Decimal(v);

describe("maxQuantityFromStock", () => {
  it("is limited by the scarcest input, rounded down to 3 places", () =>
    expect(
      maxQuantityFromStock({
        expected: D("10"),
        unit: "KILOGRAM",
        needs: [
          { needed: D("3"), available: D("2") },
          { needed: D("1"), available: D("5") },
        ],
      }).toString(),
    ).toBe("6.666"));
  it("is whole for units", () =>
    expect(
      maxQuantityFromStock({
        expected: D("100"),
        unit: "UNIT",
        needs: [{ needed: D("1.5"), available: D("1.4") }],
      }).toString(),
    ).toBe("93"));
  it("never exceeds the expected quantity", () =>
    expect(
      maxQuantityFromStock({
        expected: D("10"),
        unit: "UNIT",
        needs: [{ needed: D("1"), available: D("50") }],
      }).toString(),
    ).toBe("10"));
  it("is zero when nothing is available", () =>
    expect(
      maxQuantityFromStock({
        expected: D("10"),
        unit: "UNIT",
        needs: [{ needed: D("1"), available: D("-1") }],
      }).toString(),
    ).toBe("0"));
});
