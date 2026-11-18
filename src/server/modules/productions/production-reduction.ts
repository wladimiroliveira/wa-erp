import { type MeasurementUnit, Prisma } from "@prisma/client";
import { pickPlacesOf, toStoredDecimal } from "@/server/lib/decimal";

// Scales every input from the quantity the recipe was planned for to the one produced. Null when
// any scaled quantity rounds to nothing (or does not fit the column).
export function scaleInputs<T extends { quantity: Prisma.Decimal }>(
  inputs: T[],
  from: Prisma.Decimal,
  to: Prisma.Decimal,
): T[] | null {
  const scaled: T[] = [];

  for (const input of inputs) {
    const quantity = toStoredDecimal(input.quantity.mul(to).div(from));

    if (!quantity || quantity.lte(0)) return null;
    scaled.push({ ...input, quantity });
  }

  return scaled;
}

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
