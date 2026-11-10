import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { lotPackagingOf } from "./stock.lot-packaging";

const CAN = { id: "018f0000-0000-7000-8000-000000000101", brand: "MOÇA", content: new Prisma.Decimal("0.395") };

describe("lotPackagingOf", () => {
  it("answers the packaging with its brand, content, count and price", () => {
    expect(lotPackagingOf({ packaging: CAN, packageCount: 12, packagePrice: new Prisma.Decimal("6.49") })).toEqual({
      id: CAN.id,
      brand: "MOÇA",
      content: "0.395",
      count: 12,
      price: "6.49",
    });
  });

  it.each([
    ["no packaging", { packaging: null, packageCount: 12, packagePrice: new Prisma.Decimal("6.49") }],
    ["no count", { packaging: CAN, packageCount: null, packagePrice: new Prisma.Decimal("6.49") }],
    ["no price", { packaging: CAN, packageCount: 12, packagePrice: null }],
  ])("answers null for a lot received loose: %s", (_, lot) => {
    expect(lotPackagingOf(lot)).toBeNull();
  });
});
