import { quantityOf } from "@/features/stock/stock-format";
import type { MeasurementUnit } from "@/lib/api";
import { roundHalfUp } from "@/shared/fixed-point";
import { convert, normalizeDecimal } from "@/shared/units";

/** How many decimal places a weighing is shown and typed with, in the unit it is shown in. */
export const WEIGHING_PLACES = 3;

/** A quantity in the unit chosen to weigh it in, rounded half up to the places a scale shows: "12,346 g". */
export function weighedOf(quantity: string, from: MeasurementUnit, shown: MeasurementUnit): string {
  return quantityOf(normalizeDecimal(roundHalfUp(convert(quantity, from, shown), WEIGHING_PLACES)), shown);
}
