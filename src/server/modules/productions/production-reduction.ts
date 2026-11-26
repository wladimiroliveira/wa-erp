import { type MeasurementUnit, Prisma } from "@prisma/client";
import { pickPlacesOf } from "@/server/lib/decimal";

// The most that can be produced with what is in stock: the scarcest input limits it.
export function maxQuantityFromStock(input: {
  expected: Prisma.Decimal;
  unit: MeasurementUnit;
  needs: { needed: Prisma.Decimal; available: Prisma.Decimal }[];
}): Prisma.Decimal {
  let max = input.expected;

  for (const { needed, available } of input.needs) {
    max = Prisma.Decimal.min(max, input.expected.mul(available).div(needed));
  }

  const rounded = max.toDecimalPlaces(pickPlacesOf(input.unit), Prisma.Decimal.ROUND_DOWN);

  return Prisma.Decimal.max(rounded, 0);
}
