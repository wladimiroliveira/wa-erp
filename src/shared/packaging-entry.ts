import { divideHalfUp, fromScaled, toScaled } from "./fixed-point";
import { normalizeDecimal } from "./units";

// An entry made of packagings, turned into the product's own unit: the stock, the lots and the
// average cost know nothing else.

const PLACES = 6;

/** The quantity, in the product's unit, of `count` packagings holding `content` each. Exact. */
export function packagedQuantity(content: string, count: number): string {
  return normalizeDecimal(fromScaled(toScaled(content, PLACES) * BigInt(count), PLACES));
}

/** What one unit of the product costs when a packaging holding `content` costs `packagePrice`. */
export function packageUnitCost(packagePrice: string, content: string): string {
  return fromScaled(divideHalfUp(toScaled(packagePrice, 2 * PLACES), toScaled(content, PLACES)), PLACES);
}
