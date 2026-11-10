import { MeasurementUnit, Prisma } from "@prisma/client";
import { toStoredDecimal } from "@/server/lib/decimal";

type Amount = Prisma.Decimal.Value;

// How much of an ingredient it takes to produce `quantity`, given that the recipe takes
// `recipeQuantity` of it to yield `yieldQuantity`. Null when the result is not a quantity the
// database holds: one that rounds down to nothing, or one with more digits than the column.
export function planQuantity(input: {
  recipeQuantity: Amount;
  yieldQuantity: Amount;
  quantity: Amount;
}): Prisma.Decimal | null {
  const planned = toStoredDecimal(
    new Prisma.Decimal(input.recipeQuantity).mul(input.quantity).div(input.yieldQuantity),
  );

  return planned?.gt(0) ? planned : null;
}

type ProductSummary = { sku: string; description: string; unit: MeasurementUnit };

/** An ingredient whose opened packaging cannot be kept, as the waste of a production counts it. */
export type WasteIngredient = {
  product: ProductSummary;
  /** What the recipe takes of it to yield its yield quantity. */
  recipeQuantity: Prisma.Decimal;
  /** What one packaging of it holds, in its own unit. */
  content: Prisma.Decimal;
  averageCost: Prisma.Decimal | null;
};

export type Suggestion = {
  quantity: Prisma.Decimal;
  /** The money lost on what is left of the opened packagings, in reais to the cent; uncosted leftovers stay out. */
  loss: Prisma.Decimal;
  leftovers: { product: ProductSummary; leftover: Prisma.Decimal; loss: Prisma.Decimal | null }[];
};

// However wide the tolerance, an ingredient adds at most this many quantities to weigh up.
const MAX_CANDIDATES_PER_INGREDIENT = 1000;
const MAX_ALTERNATIVES = 3;

/**
 * Quantities to produce, from the one asked for up to `tolerance` percent more, that lose less on
 * the ingredients that cannot be kept once opened. Each is what the recipe would leave of the
 * packagings it opens, priced at the average cost.
 */
export function suggestQuantities(input: {
  quantity: Prisma.Decimal;
  yieldQuantity: Prisma.Decimal;
  unit: MeasurementUnit;
  tolerance: number;
  ingredients: WasteIngredient[];
}): { requested: Suggestion; alternatives: Suggestion[] } {
  const { quantity, yieldQuantity, unit, tolerance } = input;
  const ingredients = input.ingredients.filter(({ content, recipeQuantity }) => content.gt(0) && recipeQuantity.gt(0));
  const maximum = quantity.mul(100 + tolerance).div(100);
  const places = unit === MeasurementUnit.UNIT ? 0 : 3;

  const need = (ingredient: WasteIngredient, of: Prisma.Decimal) =>
    ingredient.recipeQuantity.mul(of).div(yieldQuantity);

  function suggestionFor(of: Prisma.Decimal): Suggestion {
    const leftovers = ingredients.flatMap((ingredient) => {
      // What the plan would weigh of it, to the places it is stored in: the leftover is counted on that.
      const needed =
        planQuantity({ recipeQuantity: ingredient.recipeQuantity, yieldQuantity, quantity: of }) ??
        new Prisma.Decimal(0);
      const leftover = needed.div(ingredient.content).ceil().mul(ingredient.content).sub(needed);

      if (leftover.isZero()) return [];

      const loss = ingredient.averageCost === null ? null : leftover.mul(ingredient.averageCost);

      return [{ product: ingredient.product, leftover, loss }];
    });
    const loss = Prisma.Decimal.sum(0, ...leftovers.flatMap(({ loss: lost }) => (lost === null ? [] : [lost])));

    return { quantity: of, loss: loss.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP), leftovers };
  }

  // Where each ingredient closes a whole number of packagings, taken both ways the unit rounds to.
  const exact = ingredients.flatMap((ingredient) => {
    const first = need(ingredient, quantity).div(ingredient.content).ceil();
    const last = Prisma.Decimal.min(
      need(ingredient, maximum).div(ingredient.content).floor(),
      first.add(MAX_CANDIDATES_PER_INGREDIENT - 1),
    );
    const closing: Prisma.Decimal[] = [];

    for (let k = first; k.lte(last); k = k.add(1)) {
      closing.push(k.mul(ingredient.content).mul(yieldQuantity).div(ingredient.recipeQuantity));
    }

    return closing;
  });
  const candidates = [maximum, ...exact]
    .flatMap((candidate) => [
      candidate.toDecimalPlaces(places, Prisma.Decimal.ROUND_DOWN),
      candidate.toDecimalPlaces(places, Prisma.Decimal.ROUND_UP),
    ])
    .filter((candidate) => candidate.gt(quantity) && candidate.lte(maximum));
  const unique = [...new Map(candidates.map((candidate) => [candidate.toString(), candidate])).values()];

  const requested = suggestionFor(quantity);
  const alternatives = unique
    .map(suggestionFor)
    .filter(({ loss }) => loss.lt(requested.loss))
    .sort((a, b) => a.loss.comparedTo(b.loss) || a.quantity.comparedTo(b.quantity))
    .slice(0, MAX_ALTERNATIVES);

  return { requested, alternatives };
}
