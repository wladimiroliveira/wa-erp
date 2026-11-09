import { MeasurementUnit, Prisma } from "@prisma/client";
import { localToday, toOptionalDateString } from "@/server/lib/dates";
import { toPage } from "@/server/lib/pagination";
import { fail, succeed, type Result } from "@/server/lib/result";
import { suggestLots } from "@/server/modules/stock/stock.repository";
import { planQuantity, suggestQuantities, type Suggestion } from "./pre-weighings.plan";
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
  yieldQuantity: Prisma.Decimal;
  items: {
    product: ProductSummary;
    plannedQuantity: Prisma.Decimal;
    // What the waste of the plan is counted from.
    recipeQuantity: Prisma.Decimal;
    isStorableOnceOpened: boolean;
    averageCost: Prisma.Decimal | null;
  }[];
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

    items.push({
      product: summaryOf(ingredient.product),
      plannedQuantity,
      recipeQuantity: ingredient.quantity,
      isStorableOnceOpened: ingredient.product.isStorableOnceOpened,
      averageCost: ingredient.product.stock?.averageCost ?? null,
    });
  }

  return succeed({ product: summaryOf(product), quantity: new Prisma.Decimal(quantity), yieldQuantity, items });
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

const presentSuggestion = ({ quantity, loss, leftovers }: Suggestion) => ({
  quantity: quantity.toString(),
  loss: loss.toFixed(2),
  leftovers: leftovers.map(({ product, leftover, loss: lost }) => ({
    product,
    leftover: leftover.toString(),
    loss: lost === null ? null : lost.toFixed(2),
  })),
});

// What the opened packagings of the ingredients that cannot be kept leave behind, and quantities
// that leave less. Each is counted in the packaging of the first lot it would be weighed from.
function wasteOf(plan: PreWeighingPlan, firstPackageContents: (Prisma.Decimal | null)[], tolerance: number) {
  const lost = plan.items.flatMap((item, index) =>
    item.isStorableOnceOpened ? [] : [{ ...item, content: firstPackageContents[index] ?? null }],
  );

  if (lost.length === 0) return null;

  const counted = lost.flatMap(({ content, ...item }) => (content === null ? [] : [{ ...item, content }]));
  const { requested, alternatives } = suggestQuantities({
    quantity: plan.quantity,
    yieldQuantity: plan.yieldQuantity,
    unit: plan.product.unit,
    tolerance,
    ingredients: counted,
  });

  return {
    tolerance,
    requested: presentSuggestion(requested),
    alternatives: alternatives.map(presentSuggestion),
    unpackaged: lost.filter(({ content }) => content === null).map(({ product }) => product),
    uncosted: counted.filter(({ averageCost }) => averageCost === null).map(({ product }) => product),
  };
}

// The plan with, for each ingredient, where to weigh it from as the stock stands now.
export async function previewPreWeighing(productSku: string, quantity: string, tolerance = 20) {
  const result = await planPreWeighing(productSku, quantity);

  if (!result.ok) return result;

  const today = localToday();
  const firstPackageContents: (Prisma.Decimal | null)[] = [];
  const items = await Promise.all(
    result.data.items.map(async ({ product, plannedQuantity }, index) => {
      const { takes, shortfall } = await suggestLots({ productSku: product.sku, quantity: plannedQuantity, today });

      firstPackageContents[index] = takes[0]?.lot.packageContent ?? null;

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

  return succeed({
    product: result.data.product,
    quantity: result.data.quantity.toString(),
    items,
    waste: wasteOf(result.data, firstPackageContents, tolerance),
  });
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
