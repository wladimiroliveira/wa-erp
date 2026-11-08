import { ProductKind, type Prisma } from "@prisma/client";
import { fail, succeed, type Result } from "@/server/lib/result";
import { costPerUnit, ingredientSubtotal, priceFor } from "@/shared/pricing";
import { findPricingSources, findProductKind, upsertMarkup, type PricingSource } from "./pricing.repository";
import type { PricingRow } from "./pricing.schemas";

// Decimal(7,2) comes back without its trailing zeros; the screen always shows two places.
const toMarkup = (markupPercent: Prisma.Decimal) => markupPercent.toFixed(2);

function toPricingRow({ yieldQuantity, product, ingredients }: PricingSource): PricingRow {
  const lines = ingredients.map(({ quantity, product: { stock, ...ingredient } }) => {
    const averageCost = stock?.averageCost?.toString() ?? null;

    return {
      product: ingredient,
      quantity: quantity.toString(),
      averageCost,
      subtotal: averageCost === null ? null : ingredientSubtotal(quantity.toString(), averageCost),
    };
  });
  const { markup, ...summary } = product;
  const markupPercent = markup === null ? null : toMarkup(markup.markupPercent);
  const cost = costPerUnit({
    yieldQuantity: yieldQuantity.toString(),
    ingredients: lines.map((line) => ({ productSku: line.product.sku, ...line })),
  });
  const unitCost = cost.status === "complete" ? cost.costPerUnit : null;

  return {
    product: summary,
    yieldQuantity: yieldQuantity.toString(),
    status: unitCost === null ? "incomplete-cost" : markupPercent === null ? "no-markup" : "priced",
    costPerUnit: unitCost,
    markupPercent,
    pricePerUnit: unitCost === null || markupPercent === null ? null : priceFor(unitCost, markupPercent),
    ingredients: lines,
  };
}

/** One row per active manufactured product with a recipe, in description order. */
export async function listPricing(): Promise<PricingRow[]> {
  return (await findPricingSources()).map(toPricingRow);
}

export async function setMarkup(
  userId: string,
  input: { productSku: string; markupPercent: string },
): Promise<Result<{ markupPercent: string }, 404 | 409>> {
  const kind = await findProductKind(input.productSku);

  if (kind === null) return fail(404, "Product not found.");

  if (kind !== ProductKind.MANUFACTURED) return fail(409, "Only a manufactured product has a markup.");

  const saved = await upsertMarkup({ ...input, updatedById: userId });

  return succeed({ markupPercent: toMarkup(saved.markupPercent) });
}
