// Cost and price of a manufactured product, shared by the server and the live preview in the
// browser. Decimals arrive and leave as strings and are worked as scaled BigInts: the browser has no
// decimal library, and a float would miss cents.

const COST_PLACES = 6;
const MARKUP_PLACES = 2;
const PRICE_PLACES = 2;

export type IngredientCost = { productSku: string; quantity: string; averageCost: string | null };

export type CostResult = { status: "complete"; costPerUnit: string } | { status: "incomplete"; missing: string[] };

const scale = (places: number) => 10n ** BigInt(places);

/** A non-negative decimal string as an integer counting units of 10^-places. */
function toScaled(value: string, places: number): bigint {
  const [integer = "0", fraction = ""] = value.split(".");

  return BigInt(integer + fraction.padEnd(places, "0").slice(0, places));
}

function fromScaled(value: bigint, places: number): string {
  const digits = value.toString().padStart(places + 1, "0");

  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

const divideHalfUp = (dividend: bigint, divisor: bigint) => (2n * dividend + divisor) / (2n * divisor);

const divideUp = (dividend: bigint, divisor: bigint) => (dividend + divisor - 1n) / divisor;

/** Exact quantity × cost, at twice the cost places. */
const product = (quantity: string, averageCost: string) =>
  toScaled(quantity, COST_PLACES) * toScaled(averageCost, COST_PLACES);

export function ingredientSubtotal(quantity: string, averageCost: string): string {
  return fromScaled(divideHalfUp(product(quantity, averageCost), scale(COST_PLACES)), COST_PLACES);
}

/** What one unit of the yield costs. A single ingredient without cost leaves the whole cost unknown. */
export function costPerUnit(input: { yieldQuantity: string; ingredients: IngredientCost[] }): CostResult {
  const missing = input.ingredients.filter((ingredient) => ingredient.averageCost === null);

  if (missing.length > 0) return { status: "incomplete", missing: missing.map((ingredient) => ingredient.productSku) };

  const total = input.ingredients.reduce(
    (sum, ingredient) => sum + product(ingredient.quantity, ingredient.averageCost as string),
    0n,
  );

  return {
    status: "complete",
    costPerUnit: fromScaled(divideHalfUp(total, toScaled(input.yieldQuantity, COST_PLACES)), COST_PLACES),
  };
}

/** The cost plus a markup in percent, rounded up to the cent: a price never sells below its cost. */
export function priceFor(costPerUnit: string, markupPercent: string): string {
  const factor = 100n * scale(MARKUP_PLACES) + toScaled(markupPercent, MARKUP_PLACES);
  const exact = toScaled(costPerUnit, COST_PLACES) * factor;

  return fromScaled(divideUp(exact, scale(COST_PLACES + MARKUP_PLACES + 2 - PRICE_PLACES)), PRICE_PLACES);
}
