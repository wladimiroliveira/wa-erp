import { MeasurementUnit, Prisma } from "@prisma/client";
import { pickPlacesOf } from "@/shared/units";

export { decimalSchema, positiveDecimalSchema } from "@/shared/decimal";
export { pickPlacesOf };

export const TOO_MANY_PLACES = "The quantity has more decimal places than the unit allows.";

// Whether the operator could have picked this quantity of a product in this unit.
export const fitsPlacesOf = (quantity: Prisma.Decimal, unit: MeasurementUnit): boolean =>
  quantity.decimalPlaces() <= pickPlacesOf(unit);

const DECIMAL_PLACES = 6;
const UPPER_BOUND = new Prisma.Decimal("1e12");

// Rounds a computed amount to what numeric(18,6) holds. Null when it has more integer digits than
// the column.
export function toStoredDecimal(value: Prisma.Decimal): Prisma.Decimal | null {
  const rounded = value.toDecimalPlaces(DECIMAL_PLACES);

  return rounded.lt(UPPER_BOUND) ? rounded : null;
}
