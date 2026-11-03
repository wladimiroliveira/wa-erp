import { Prisma } from "@prisma/client";

export { decimalSchema, positiveDecimalSchema } from "@/shared/decimal";

const DECIMAL_PLACES = 6;
const UPPER_BOUND = new Prisma.Decimal("1e12");

// Rounds a computed amount to what numeric(18,6) holds. Null when it has more integer digits than
// the column.
export function toStoredDecimal(value: Prisma.Decimal): Prisma.Decimal | null {
  const rounded = value.toDecimalPlaces(DECIMAL_PLACES);

  return rounded.lt(UPPER_BOUND) ? rounded : null;
}
