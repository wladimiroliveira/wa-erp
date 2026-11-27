import { ProductKind, type Prisma } from "@prisma/client";
import { localToday } from "@/server/lib/dates";
import { prisma } from "@/server/lib/prisma";
import { fail, succeed, type Result } from "@/server/lib/result";
import { lockStockBalance, onHandUnitCost } from "@/server/modules/stock/stock.repository";
import { priceFor } from "@/shared/pricing";
import {
  findCurrentPrice,
  findPricingInputs,
  findPricingSources,
  findProductKind,
  insertPrice,
  upsertMarkup,
  type PricingSource,
} from "./pricing.repository";
import type { PriceEntry, PricingRow } from "./pricing.schemas";

// Decimal(7,2) comes back without its trailing zeros; the screen always shows two places.
const toMarkup = (markupPercent: Prisma.Decimal) => markupPercent.toFixed(2);

const toPriceEntry = (price: PricingSource["prices"][number]): PriceEntry => ({
  price: price.price.toFixed(2),
  averageCost: price.averageCost.toString(),
  markupPercent: toMarkup(price.markupPercent),
  createdAt: price.createdAt.toISOString(),
});

async function toPricingRow({ markup, prices, ...product }: PricingSource): Promise<PricingRow> {
  const history = prices.map(toPriceEntry);
  const onHand = await onHandUnitCost(prisma, { productSku: product.sku, today: localToday() });

  return {
    product,
    status: markup === null ? "no-markup" : history.length === 0 ? "no-price" : "priced",
    markupPercent: markup === null ? null : toMarkup(markup.markupPercent),
    onHandCost: onHand?.toString() ?? null,
    currentPrice: history[0] ?? null,
    history,
  };
}

/** One row per active manufactured product, in description order. */
export async function listPricing(): Promise<PricingRow[]> {
  return Promise.all((await findPricingSources()).map(toPricingRow));
}

/**
 * Writes a price for what is on hand now: the cost of the lots on hand with the product's markup.
 * Only a manufactured product with a markup and something on hand is priced; for any other this does nothing.
 */
export async function repriceProduct(
  tx: Prisma.TransactionClient,
  input: { productSku: string; today: string },
): Promise<void> {
  const { productSku, today } = input;
  const inputs = await findPricingInputs(tx, productSku);

  if (inputs === null || inputs.kind !== ProductKind.MANUFACTURED || inputs.markupPercent === null) return;

  const basis = await onHandUnitCost(tx, { productSku, today });

  if (basis === null) return;

  const markupPercent = toMarkup(inputs.markupPercent);

  await insertPrice(tx, {
    productSku,
    averageCost: basis.toString(),
    markupPercent,
    price: priceFor(basis.toString(), markupPercent),
  });
}

export async function setMarkup(
  userId: string,
  input: { productSku: string; markupPercent: string },
): Promise<Result<{ markupPercent: string }, 404 | 409>> {
  const kind = await findProductKind(input.productSku);

  if (kind === null) return fail(404, "Product not found.");

  if (kind !== ProductKind.MANUFACTURED) return fail(409, "Only a manufactured product has a markup.");

  const saved = await upsertMarkup({ ...input, updatedById: userId });

  // A markup changes no price already written; it only starts pricing a product that has none yet.
  // The balance is held first so two first prices cannot both be written.
  await prisma.$transaction(async (tx) => {
    await lockStockBalance(tx, input.productSku);

    if ((await findCurrentPrice(tx, input.productSku)) === null) {
      await repriceProduct(tx, { productSku: input.productSku, today: localToday() });
    }
  });

  return succeed({ markupPercent: toMarkup(saved.markupPercent) });
}
