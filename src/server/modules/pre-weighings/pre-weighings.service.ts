import { MeasurementUnit, Prisma } from "@prisma/client";
import { localToday, toOptionalDateString } from "@/server/lib/dates";
import { toPage } from "@/server/lib/pagination";
import { fail, succeed, type Result } from "@/server/lib/result";
import { suggestLots } from "@/server/modules/stock/stock.repository";
import { planQuantity } from "./pre-weighings.plan";
import {
  findPreWeighingById,
  findProductWithRecipe,
  insertPreWeighing,
  listPreWeighings,
  type PreWeighingRecord,
} from "./pre-weighings.repository";

type ProductSummary = { sku: string; description: string; unit: MeasurementUnit };

export type PreWeighingPlan = {
  product: ProductSummary;
  quantity: Prisma.Decimal;
  items: { product: ProductSummary; plannedQuantity: Prisma.Decimal }[];
};

type PlanFailure = 404 | 409;

const summaryOf = ({ sku, description, unit }: ProductSummary): ProductSummary => ({ sku, description, unit });

// The one place that decides whether a product can be pre-weighed and how much of each ingredient
// that takes. The preview and the record both come through here, so what the operator was shown is
// what gets recorded as planned.
export async function planPreWeighing(
  productSku: string,
  quantity: string,
): Promise<Result<PreWeighingPlan, PlanFailure>> {
  const product = await findProductWithRecipe(productSku);

  if (product === null) return fail(404, "Product not found.");
  if (!product.isActive) return fail(409, "Product is inactive.");
  if (product.recipe === null) return fail(409, "Product has no recipe.");

  const { yieldQuantity, ingredients } = product.recipe;

  if (ingredients.some((ingredient) => !ingredient.product.isActive)) {
    return fail(409, "The recipe takes an inactive product.");
  }

  const items: PreWeighingPlan["items"] = [];

  for (const ingredient of ingredients) {
    const plannedQuantity = planQuantity({ recipeQuantity: ingredient.quantity, yieldQuantity, quantity });

    if (plannedQuantity === null) return fail(409, "Quantity is out of range for this recipe.");

    items.push({ product: summaryOf(ingredient.product), plannedQuantity });
  }

  return succeed({ product: summaryOf(product), quantity: new Prisma.Decimal(quantity), items });
}

/** A pre-weighing as the screens and the mobile app read it: every amount as a decimal string. */
export const presentPreWeighing = (preWeighing: PreWeighingRecord) => ({
  id: preWeighing.id,
  product: preWeighing.product,
  quantity: preWeighing.quantity.toString(),
  createdAt: preWeighing.createdAt.toISOString(),
  items: preWeighing.items.map(({ product, plannedQuantity, weighedQuantity }) => ({
    product,
    plannedQuantity: plannedQuantity.toString(),
    weighedQuantity: weighedQuantity.toString(),
  })),
});

export type PresentedPreWeighing = ReturnType<typeof presentPreWeighing>;

// The plan with, for each ingredient, where to weigh it from as the stock stands now.
export async function previewPreWeighing(productSku: string, quantity: string) {
  const result = await planPreWeighing(productSku, quantity);

  if (!result.ok) return result;

  const today = localToday();
  const items = await Promise.all(
    result.data.items.map(async ({ product, plannedQuantity }) => {
      const { takes, shortfall } = await suggestLots({ productSku: product.sku, quantity: plannedQuantity, today });

      return {
        product,
        plannedQuantity: plannedQuantity.toString(),
        lots: takes.map(({ lot, quantity }) => ({
          id: lot.id,
          expiresAt: toOptionalDateString(lot.expiresAt),
          quantity: quantity.toString(),
        })),
        shortfall: shortfall.toString(),
      };
    }),
  );

  return succeed({ product: result.data.product, quantity: result.data.quantity.toString(), items });
}

export async function recordPreWeighing(input: {
  productSku: string;
  quantity: string;
  createdById: string;
  items: { productSku: string; weighedQuantity: string }[];
}): Promise<Result<PresentedPreWeighing, PlanFailure>> {
  const { productSku, quantity, items } = input;
  const result = await planPreWeighing(productSku, quantity);

  if (!result.ok) return result;

  const weighedBySku = new Map(items.map((item) => [item.productSku.toLowerCase(), item.weighedQuantity]));
  const planned = result.data.items;

  if (planned.length !== weighedBySku.size || planned.some(({ product }) => !weighedBySku.has(product.sku))) {
    return fail(409, "The items do not match the ingredients of the recipe.");
  }

  const preWeighing = await insertPreWeighing({
    productSku,
    quantity,
    createdById: input.createdById,
    items: planned.map(({ product, plannedQuantity }) => ({
      productSku: product.sku,
      plannedQuantity,
      weighedQuantity: weighedBySku.get(product.sku)!,
    })),
  });

  return succeed(presentPreWeighing(preWeighing));
}

export async function getPreWeighing(id: string): Promise<Result<PresentedPreWeighing, 404>> {
  const preWeighing = await findPreWeighingById(id);

  if (preWeighing === null) return fail(404, "Pre-weighing not found.");

  return succeed(presentPreWeighing(preWeighing));
}

export async function listPreWeighingsPage(query: { available?: boolean; limit: number; cursor?: string }) {
  const { items, nextCursor } = toPage(await listPreWeighings(query), query);

  return { items: items.map(presentPreWeighing), nextCursor };
}
