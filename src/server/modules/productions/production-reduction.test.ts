import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { maxQuantityFromStock, scaleInputs } from "@/server/modules/productions/production-reduction";

const D = (v: string) => new Prisma.Decimal(v);

describe("scaleInputs", () => {
  it("scales every input by the ratio", () =>
    expect(
      scaleInputs(
        [
          { productSku: "a", quantity: D("10") },
          { productSku: "b", quantity: D("0.3") },
        ],
        D("100"),
        D("90"),
      )!.map((i) => i.quantity.toString()),
    ).toEqual(["9", "0.27"]));
  it("is null when an input rounds to nothing", () =>
    expect(scaleInputs([{ productSku: "a", quantity: D("0.000001") }], D("100"), D("1"))).toBeNull());
});

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
