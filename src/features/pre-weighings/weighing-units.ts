import { quantityOf } from "@/features/stock/stock-format";
import type { MeasurementUnit } from "@/lib/api";
import { isDecimalInput, toApiDecimal } from "@/lib/decimal";
import { roundHalfUp } from "@/shared/fixed-point";
import { convert, normalizeDecimal, readableQuantity } from "@/shared/units";

/** How many decimal places a weighing is shown and typed with, in the unit it is shown in. */
export const WEIGHING_PLACES = 3;

/** A quantity in the unit chosen to weigh it in, rounded half up to the places a scale shows: "12,346 g". */
export function weighedOf(quantity: string, from: MeasurementUnit, shown: MeasurementUnit): string {
  return quantityOf(normalizeDecimal(roundHalfUp(convert(quantity, from, shown), WEIGHING_PLACES)), shown);
}

/** What a field says when the weighed quantity is not one a scale could show. */
export const WEIGHED_MESSAGE = `Informe o pesado, com até ${WEIGHING_PLACES} casas decimais.`;

/** The unit a line is weighed in until the operator picks another: the one its planned quantity reads best in. */
export const weighingUnitOf = (productUnit: MeasurementUnit, plannedQuantity: string): MeasurementUnit =>
  readableQuantity(plannedQuantity, productUnit).unit;

/** Whether a typed decimal has no more places than a scale shows. */
export const hasWeighingPlaces = (typed: string): boolean => (typed.split(",")[1]?.length ?? 0) <= WEIGHING_PLACES;

/** Whether what was typed is a weighing: a decimal above zero, with the places a scale shows. */
export const isWeighed = (typed: string | undefined): typed is string =>
  typed !== undefined && isDecimalInput(typed) && Number(toApiDecimal(typed)) > 0 && hasWeighingPlaces(typed);

/** What was typed in the unit it was weighed in, as the API decimal of the product's unit. */
export const toProductUnit = (typed: string, shown: MeasurementUnit, productUnit: MeasurementUnit): string =>
  convert(toApiDecimal(typed), shown, productUnit);
