// Cost and price of a manufactured product, shared by the server and the live preview in the
// browser. Decimals arrive and leave as strings and are worked as scaled BigInts.
import { fromScaled, scale, toScaled } from "./fixed-point";

const COST_PLACES = 6;
const MARKUP_PLACES = 2;
const PRICE_PLACES = 2;

const divideUp = (dividend: bigint, divisor: bigint) => (dividend + divisor - 1n) / divisor;

/** The cost plus a markup in percent, rounded up to the cent: a price never sells below its cost. */
export function priceFor(costPerUnit: string, markupPercent: string): string {
  const factor = 100n * scale(MARKUP_PLACES) + toScaled(markupPercent, MARKUP_PLACES);
  const exact = toScaled(costPerUnit, COST_PLACES) * factor;

  return fromScaled(divideUp(exact, scale(COST_PLACES + MARKUP_PLACES + 2 - PRICE_PLACES)), PRICE_PLACES);
}
