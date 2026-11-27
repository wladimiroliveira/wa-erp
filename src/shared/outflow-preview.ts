// What an outflow of the typed quantity would bring in and cost, for the form to show while it is
// filled. It mirrors the server's rounding (each amount to the cent, half up, profit from the
// rounded amounts) on decimal strings, so no amount passes through a float.
import { divideHalfUp, fromScaled, scale, toScaled } from "./fixed-point";

const QUANTITY_PLACES = 6;
const PRICE_PLACES = 2;
const COST_PLACES = 6;

// A product of two decimals, rounded half up to cents, as cents.
function centsOf(first: string, firstPlaces: number, second: string, secondPlaces: number): bigint {
  const exact = toScaled(first, firstPlaces) * toScaled(second, secondPlaces);

  return divideHalfUp(exact, scale(firstPlaces + secondPlaces - 2));
}

const asMoney = (cents: bigint) => `${cents < 0n ? "-" : ""}${fromScaled(cents < 0n ? -cents : cents, 2)}`;

export function previewOutflow(input: { quantity: string; unitPrice: string | null; unitCost: string }): {
  revenue: string | null;
  cost: string;
  profit: string | null;
} {
  const cost = centsOf(input.quantity, QUANTITY_PLACES, input.unitCost, COST_PLACES);

  if (input.unitPrice === null) return { revenue: null, cost: asMoney(cost), profit: null };

  const revenue = centsOf(input.quantity, QUANTITY_PLACES, input.unitPrice, PRICE_PLACES);

  return { revenue: asMoney(revenue), cost: asMoney(cost), profit: asMoney(revenue - cost) };
}
