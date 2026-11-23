import { MeasurementUnit, Prisma, ProductKind } from "@prisma/client";
import type { z } from "zod";
import { fitsPlacesOf, TOO_MANY_PLACES } from "@/server/lib/decimal";
import { localToday, toOptionalDateString } from "@/server/lib/dates";
import { toPage } from "@/server/lib/pagination";
import { fail, succeed, type Failure, type Result } from "@/server/lib/result";
import { suggestLots } from "@/server/modules/stock/stock.repository";
import { defaultToProduce, planQuantity, suggestQuantities, type Suggestion } from "./pre-weighings.plan";
import { preWeighingStatusOf, type PreWeighingStatus } from "./pre-weighing-status";
import {
  countStalePreWeighings,
  deletePreWeighingTree,
  findComplementParent,
  findPreWeighingById,
  findProductWithRecipe,
  listPendingChildren,
  listPendingStartRoots,
  insertPreWeighingTree,
  listPreWeighings,
  type PlannedStage,
  type PreWeighingRecord,
} from "./pre-weighings.repository";
import type { preWeighingStageBodySchema } from "./pre-weighings.schemas";

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
    // Set for an ingredient that is itself manufactured: what is in stock, what is to be produced
    // and the plan of that production (null when nothing is to be produced).
    manufactured: { inStock: Prisma.Decimal; toProduce: Prisma.Decimal; stage: PreWeighingPlan | null } | null;
  }[];
};

type PlanFailure = 404 | 409;

const summaryOf = ({ sku, description, unit }: ProductSummary): ProductSummary => ({ sku, description, unit });

type ProductWithRecipe = NonNullable<Awaited<ReturnType<typeof findProductWithRecipe>>>;

// Reads each product of a plan once, however many places of the tree it appears at.
function catalog(): (sku: string) => Promise<ProductWithRecipe | null> {
  const read = new Map<string, Promise<ProductWithRecipe | null>>();

  return (sku) => {
    const key = sku.toLowerCase();
    const found = read.get(key) ?? findProductWithRecipe(key);

    read.set(key, found);

    return found;
  };
}

// Whether the plan of a product can be built from its recipe.
const canBeProduced = (product: ProductWithRecipe) =>
  product.isActive &&
  product.recipe !== null &&
  product.recipe.ingredients.every((ingredient) => ingredient.product.isActive);

// How much to produce of each intermediate the tree of `productSku` reaches, by sku. An intermediate is
// produced once for the whole tree, so by default it is the shortfall of what every place takes of it
// against its stock. What a product takes counts only while that product is produced, so each product is
// decided before the ones it takes; recipes are acyclic, which makes that order exist.
async function decideToProduce(
  read: ReturnType<typeof catalog>,
  productSku: string,
  quantity: Prisma.Decimal,
  produce?: ReadonlyMap<string, Prisma.Decimal>,
): Promise<Map<string, Prisma.Decimal>> {
  const visited = new Set<string>();
  const takersFirst: ProductWithRecipe[] = [];
  const stockOf = new Map<string, Prisma.Decimal>();

  async function visit(sku: string): Promise<void> {
    if (visited.has(sku)) return;

    visited.add(sku);
    const product = await read(sku);

    if (product === null) return;

    for (const ingredient of product.recipe?.ingredients ?? []) {
      if (ingredient.product.kind !== ProductKind.MANUFACTURED) continue;

      stockOf.set(ingredient.product.sku, ingredient.product.stock?.quantity ?? new Prisma.Decimal(0));
      await visit(ingredient.product.sku);
    }

    takersFirst.unshift(product);
  }

  await visit(productSku.toLowerCase());

  const needs = new Map<string, Prisma.Decimal>();
  const decided = new Map<string, Prisma.Decimal>();

  for (const [index, product] of takersFirst.entries()) {
    let made = quantity;

    if (index > 0) {
      // An intermediate that cannot be produced is taken from stock unless the operator asks for it,
      // so the plan of its taker still shows, with a shortfall where its stock falls short.
      made =
        produce?.get(product.sku) ??
        (canBeProduced(product)
          ? defaultToProduce(
              needs.get(product.sku) ?? new Prisma.Decimal(0),
              stockOf.get(product.sku) ?? new Prisma.Decimal(0),
              product.unit,
            )
          : new Prisma.Decimal(0));
      decided.set(product.sku, made);
    }

    if (!made.gt(0) || product.recipe === null) continue;

    for (const ingredient of product.recipe.ingredients) {
      if (ingredient.product.kind !== ProductKind.MANUFACTURED) continue;

      // A quantity out of range fails the plan of this stage when it is built.
      const needed = planQuantity({
        recipeQuantity: ingredient.quantity,
        yieldQuantity: product.recipe.yieldQuantity,
        quantity: made,
      });

      if (needed !== null) {
        needs.set(ingredient.product.sku, (needs.get(ingredient.product.sku) ?? new Prisma.Decimal(0)).plus(needed));
      }
    }
  }

  return decided;
}

// The plan of one stage. An intermediate to produce gets its stage at its first place in depth-first
// order; its other places take it from the stock that stage replenishes.
async function planStage(
  read: ReturnType<typeof catalog>,
  productSku: string,
  quantity: string | Prisma.Decimal,
  decided: ReadonlyMap<string, Prisma.Decimal> | null,
  staged: Set<string>,
): Promise<Result<PreWeighingPlan, PlanFailure>> {
  const product = await read(productSku);

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

    let manufactured: PreWeighingPlan["items"][number]["manufactured"] = null;

    if (decided !== null && ingredient.product.kind === ProductKind.MANUFACTURED) {
      const inStock = ingredient.product.stock?.quantity ?? new Prisma.Decimal(0);
      const toProduce = decided.get(ingredient.product.sku) ?? new Prisma.Decimal(0);
      let stage: PreWeighingPlan | null = null;

      if (!fitsPlacesOf(toProduce, ingredient.product.unit)) return fail(409, TOO_MANY_PLACES);

      if (toProduce.gt(0) && !staged.has(ingredient.product.sku)) {
        staged.add(ingredient.product.sku);
        const planned = await planStage(read, ingredient.product.sku, toProduce, decided, staged);

        if (!planned.ok) return planned;

        stage = planned.data;
      }

      manufactured = { inStock, toProduce, stage };
    }

    items.push({
      product: summaryOf(ingredient.product),
      plannedQuantity,
      recipeQuantity: ingredient.quantity,
      isStorableOnceOpened: ingredient.product.isStorableOnceOpened,
      averageCost: ingredient.product.stock?.averageCost ?? null,
      manufactured,
    });
  }

  return succeed({ product: summaryOf(product), quantity: new Prisma.Decimal(quantity), yieldQuantity, items });
}

// The one place that decides whether a product can be pre-weighed and how much of each ingredient
// that takes. The preview and the record both come through here, so what the operator was shown is
// what gets recorded as planned.
// `produce` says how much to produce of an intermediate, by lower-case sku, at any depth of the plan;
// the shortfall of its stock is produced otherwise, or nothing of one that cannot be produced.
export async function planPreWeighing(
  productSku: string,
  quantity: string | Prisma.Decimal,
  produce?: ReadonlyMap<string, Prisma.Decimal>,
  // A free production plans its own stage only; the stages of its intermediates are left out.
  { stages = true }: { stages?: boolean } = {},
): Promise<Result<PreWeighingPlan, PlanFailure>> {
  const read = catalog();
  const decided = stages ? await decideToProduce(read, productSku, new Prisma.Decimal(quantity), produce) : null;

  return planStage(read, productSku, quantity, decided, new Set());
}

/** A pre-weighing as the screens and the mobile app read it: every amount as a decimal string. */
export const presentPreWeighing = (preWeighing: PreWeighingRecord) => ({
  id: preWeighing.id,
  product: preWeighing.product,
  quantity: preWeighing.quantity.toString(),
  createdAt: preWeighing.createdAt.toISOString(),
  // Only a pending one can start a production and be deleted.
  status: preWeighingStatusOf({
    damaged: preWeighing.damage !== null,
    itemStatus: preWeighing.production?.status ?? null,
  }),
  parent: preWeighing.parent,
  children: preWeighing.children.map(({ id, product, quantity }) => ({ id, product, quantity: quantity.toString() })),
  items: preWeighing.items.map(({ product, plannedQuantity, weighedQuantity }) => ({
    product,
    plannedQuantity: plannedQuantity.toString(),
    weighedQuantity: weighedQuantity?.toString() ?? null,
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

// The plan with, for each ingredient, where to weigh it from as the stock stands now; the stages of
// the intermediates the same way.
async function previewPlan(plan: PreWeighingPlan, tolerance: number, today: string): Promise<PreviewedPlan> {
  const firstPackageContents: (Prisma.Decimal | null)[] = [];
  const items = await Promise.all(
    plan.items.map(async ({ product, plannedQuantity, manufactured }, index) => {
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
        manufactured:
          manufactured === null
            ? null
            : {
                needed: plannedQuantity.toString(),
                inStock: manufactured.inStock.toString(),
                toProduce: manufactured.toProduce.toString(),
                stage: manufactured.stage === null ? null : await previewPlan(manufactured.stage, tolerance, today),
              },
      };
    }),
  );

  return {
    product: plan.product,
    quantity: plan.quantity.toString(),
    items,
    waste: wasteOf(plan, firstPackageContents, tolerance),
  };
}

type PreviewedPlan = {
  product: ProductSummary;
  quantity: string;
  items: {
    product: ProductSummary;
    plannedQuantity: string;
    lots: { id: string; expiresAt: string | null; quantity: string }[];
    shortfall: string;
    manufactured: {
      needed: string;
      inStock: string;
      toProduce: string;
      stage: PreviewedPlan | null;
    } | null;
  }[];
  waste: ReturnType<typeof wasteOf>;
};

export async function previewPreWeighing(
  productSku: string,
  quantity: string,
  tolerance = 20,
  produce?: ReadonlyMap<string, string>,
) {
  const toProduce = produce && new Map([...produce].map(([sku, amount]) => [sku, new Prisma.Decimal(amount)]));
  const result = await planPreWeighing(productSku, quantity, toProduce);

  if (!result.ok) return result;

  return succeed(await previewPlan(result.data, tolerance, localToday()));
}

export type StageBody = z.output<typeof preWeighingStageBodySchema>;

const STAGE_MISMATCH = "A stage does not match the plan.";
const ITEMS_MISMATCH = "The items do not match the ingredients of the recipe.";

// What to produce of each intermediate, by lower-case sku, as the stages say. The same intermediate
// asked for twice in different quantities cannot be planned.
function producedBy(stages: StageBody[], produced = new Map<string, Prisma.Decimal>()) {
  for (const stage of stages) {
    const sku = stage.productSku.toLowerCase();
    const quantity = new Prisma.Decimal(stage.quantity);

    if (produced.get(sku)?.eq(quantity) === false) return null;

    produced.set(sku, quantity);

    if (producedBy(stage.stages, produced) === null) return null;
  }

  return produced;
}

// A plan reads an intermediate the stages do not name as to be taken from stock.
class NothingElse extends Map<string, Prisma.Decimal> {
  override get(sku: string) {
    return super.get(sku) ?? new Prisma.Decimal(0);
  }
}

// Checks what was sent against the plan, stage by stage, and gives back what is to be recorded. Every
// ingredient of the recipe is sent once: a bought one with what was weighed of it, a manufactured one
// without, since it is taken from stock.
function matchStage(plan: PreWeighingPlan, sent: StageBody): Result<PlannedStage, 409> {
  const sentBySku = new Map(sent.items.map((item) => [item.productSku.toLowerCase(), item]));
  const matches =
    sent.items.length === plan.items.length &&
    plan.items.every(({ product, manufactured }) => {
      const item = sentBySku.get(product.sku);

      return item !== undefined && (manufactured === null) === (item.weighedQuantity !== undefined);
    });

  if (!matches) return fail(409, ITEMS_MISMATCH);

  const stagesBySku = new Map(sent.stages.map((stage) => [stage.productSku.toLowerCase(), stage]));
  const staged = plan.items.filter(({ manufactured }) => manufactured?.stage);

  // Every stage names a distinct intermediate of this plan that is to be produced.
  if (stagesBySku.size !== sent.stages.length || stagesBySku.size !== staged.length) {
    return fail(409, STAGE_MISMATCH);
  }

  const stages: PlannedStage[] = [];

  for (const { product, manufactured } of staged) {
    const stage = stagesBySku.get(product.sku);

    if (stage === undefined || !manufactured?.stage) return fail(409, STAGE_MISMATCH);

    const matched = matchStage(manufactured.stage, stage);

    if (!matched.ok) return matched;

    stages.push(matched.data);
  }

  return succeed({
    productSku: plan.product.sku,
    quantity: sent.quantity,
    items: plan.items.map(({ product, plannedQuantity }) => ({
      productSku: product.sku,
      plannedQuantity,
      weighedQuantity: sentBySku.get(product.sku)?.weighedQuantity ?? null,
    })),
    stages,
  });
}

/** Refused wherever a complement is recorded under a pre-weighing whose recipe does not take its product. */
export const PARENT_DOES_NOT_TAKE = "The parent's recipe does not take this product.";

// Why a complement cannot go under a parent that is no longer pending. One in production takes its
// complement through the production, which joins it there and holds the production while it does.
const PARENT_NOT_PENDING: Record<Exclude<PreWeighingStatus, "PENDING">, string> = {
  IN_PRODUCTION: "The parent is in production; record the complement through the production.",
  PRODUCED: "The parent has already been produced.",
  DAMAGED: "The parent was damaged.",
};

// A complement goes under a pending pre-weighing whose recipe takes its product.
async function checkParent(parentId: string, productSku: string): Promise<Failure<404 | 409> | null> {
  const parent = await findComplementParent(parentId);

  if (parent === null) return fail(404, "Pre-weighing not found.");

  const takesIt = parent.product.recipe?.ingredients.some((ingredient) => ingredient.productSku === productSku);

  if (!takesIt) return fail(409, PARENT_DOES_NOT_TAKE);

  const status = preWeighingStatusOf({
    damaged: parent.damage !== null,
    itemStatus: parent.production?.status ?? null,
  });

  if (status !== "PENDING") return fail(409, PARENT_NOT_PENDING[status]);

  return null;
}

/**
 * Plans a tree as it was sent, each intermediate produced as its stage says, and checks what was sent
 * against that plan. Nothing is written: the tree comes back ready to be recorded.
 */
export async function preparePreWeighing(tree: StageBody): Promise<Result<PlannedStage, PlanFailure>> {
  const produced = producedBy(tree.stages);

  if (produced === null) return fail(409, STAGE_MISMATCH);

  const result = await planPreWeighing(tree.productSku, tree.quantity, new NothingElse(produced));

  if (!result.ok) return result;

  return matchStage(result.data, tree);
}

export async function recordPreWeighing(
  input: StageBody & { parentId?: string; createdById: string },
): Promise<Result<PresentedPreWeighing, PlanFailure>> {
  const { parentId, createdById, ...tree } = input;

  if (parentId !== undefined) {
    const refusal = await checkParent(parentId, tree.productSku.toLowerCase());

    if (refusal !== null) return refusal;
  }

  const planned = await preparePreWeighing(tree);

  if (!planned.ok) return planned;

  const preWeighing = await insertPreWeighingTree(planned.data, { createdById, parentId: parentId ?? null });

  return succeed(presentPreWeighing(preWeighing));
}

/** Deletes a pending pre-weighing, with the ones recorded under it. */
export async function removePreWeighing(id: string): Promise<Result<null, 404 | 409>> {
  const outcome = await deletePreWeighingTree(id);

  if (outcome === "missing") return fail(404, "Pre-weighing not found.");
  if (outcome === "not-pending") return fail(409, "The pre-weighing is not pending.");

  return succeed(null);
}

export async function getPreWeighing(id: string): Promise<Result<PresentedPreWeighing, 404>> {
  const preWeighing = await findPreWeighingById(id);

  if (preWeighing === null) return fail(404, "Pre-weighing not found.");

  return succeed(presentPreWeighing(preWeighing));
}

export const countStale = () => countStalePreWeighings();

export async function listPreWeighingsPage(query: {
  status?: PreWeighingStatus;
  staleOnly?: "true";
  limit: number;
  cursor?: string;
}) {
  const { items, nextCursor } = toPage(
    await listPreWeighings({ ...query, staleOnly: query.staleOnly === "true" }),
    query,
  );

  return { items: items.map(presentPreWeighing), nextCursor };
}

export type StartCandidate = PresentedPreWeighing & { stages: StartCandidate[] };

// Every pending pre-weighing a guided production can start from, with the pending ones under it nested:
// a child that is not pending cuts its branch.
export async function listStartCandidates(): Promise<StartCandidate[]> {
  const roots = await listPendingStartRoots();
  const candidates = new Map<string, StartCandidate>();
  let level = roots.map((root) => {
    const candidate: StartCandidate = { ...presentPreWeighing(root), stages: [] };
    candidates.set(root.id, candidate);

    return candidate;
  });

  while (level.length > 0) {
    const children = await listPendingChildren(level.map(({ id }) => id));

    level = children.map((child) => {
      const candidate: StartCandidate = { ...presentPreWeighing(child), stages: [] };
      candidates.set(child.id, candidate);
      candidates.get(child.parent!.id)!.stages.push(candidate);

      return candidate;
    });
  }

  return roots.map(({ id }) => candidates.get(id)!);
}
