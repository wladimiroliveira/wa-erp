import type { z } from "zod";
import { MeasurementUnit, Prisma, ProductionItemStatus, ProductionStatus } from "@prisma/client";
import { localToday, toOptionalDateString } from "@/server/lib/dates";
import { toPage } from "@/server/lib/pagination";
import { isUniqueViolation } from "@/server/lib/prisma-errors";
import { fail, failWith, succeed, type Failure, type Result } from "@/server/lib/result";
import { findPreWeighingTree, isPendingStartRoot } from "@/server/modules/pre-weighings/pre-weighings.repository";
import type { PreWeighingRecord } from "@/server/modules/pre-weighings/pre-weighings.repository";
import { preWeighingStatusOf } from "@/server/modules/pre-weighings/pre-weighing-status";
import { planPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";
import { holdReasonInUse, RefusedReason } from "@/server/modules/losses/losses.repository";
import { REASON_FAILURES } from "@/server/modules/losses/losses.service";
import { holdStockBalances, readStockBalance } from "@/server/modules/stock/stock.repository";
import {
  closeIfResolved,
  findProductionById,
  inProductionTransaction,
  insertItemDamage,
  insertProduction,
  listProductions,
  lockProductionInProgress,
  markItemSubstituted,
  previewProductionLeftovers,
  writeOffForDamage,
} from "./productions.repository";
import type { PlannedProductionItem, ProductionRecord } from "./productions.repository";
import type { startProductionBodySchema } from "./productions.schemas";
import { asConcluded, isTakenByAnother } from "./production-batches";
import { dependenciesOf, waitingFor, type DependencyItem } from "./production-dependencies";

export type ProductionFailure = Failure<404 | 409>;
export type ProductionResult = Result<PresentedProduction, 404 | 409>;

export const productionNotFound = fail(404, "Production not found.");
const notInProgress = fail(409, "Production is not in progress.");
export const notPending = fail(409, "The item is not pending.");
export const itemNotFound = fail(404, "Production item not found.");
export const awaitsNewWeighing = fail(409, "The item waits for a new weighing.");

export type ProductionItemRecord = ProductionRecord["items"][number];

export const summaryOf = ({ sku, description, unit }: { sku: string; description: string; unit: MeasurementUnit }) => ({
  sku,
  description,
  unit,
});

const dependencyItemsOf = (items: ProductionItemRecord[]): DependencyItem[] =>
  items.map((item) => ({
    id: item.id,
    productSku: item.product.sku,
    status: item.status,
    inputSkus: item.inputs.map(({ product }) => product.sku),
  }));

// A damage that named the pre-weighing of a guided item took it away, and an item added for a shortage
// has nothing to be made from: neither can be made until a weighing is recorded for it. A free item
// damaged keeps its inputs, ready to be made again.
export const awaitsWeighing = (item: ProductionItemRecord) =>
  item.preWeighingId === null &&
  (item.damages.some((damage) => damage.preWeighingId !== null) || item.inputs.length === 0);

/** A production as the screens and the mobile app read it: every amount as a decimal string. */
export const presentProduction = (production: ProductionRecord) => {
  const dependencies = dependenciesOf(dependencyItemsOf(production.items));

  return {
    id: production.id,
    status: production.status,
    createdAt: production.createdAt.toISOString(),
    finishedAt: production.finishedAt?.toISOString() ?? null,
    canceledAt: production.canceledAt?.toISOString() ?? null,
    items: production.items.map((item) => ({
      id: item.id,
      status: item.status,
      finishedAt: item.finishedAt?.toISOString() ?? null,
      hasLeftoversInCost: item.hasLeftoversInCost,
      product: item.product,
      substitutedAt: item.substitutedAt?.toISOString() ?? null,
      weighedAt: item.preWeighing?.createdAt.toISOString() ?? null,
      preWeighingId: item.preWeighingId,
      expectedQuantity: item.expectedQuantity.toString(),
      producedQuantity: item.producedQuantity?.toString() ?? null,
      unitCost: item.unitCost?.toString() ?? null,
      dependsOn: dependencies.get(item.id) ?? [],
      awaitsWeighing: awaitsWeighing(item),
      batches: item.batches.map(({ id, quantity, expiresAt, source, createdAt }) => ({
        id,
        quantity: quantity.toString(),
        expiresAt: toOptionalDateString(expiresAt),
        source,
        createdAt: createdAt.toISOString(),
      })),
      extraWeighings: item.extraWeighings.length,
      damages: item.damages.map(({ id, reason, note, createdAt, preWeighingId }) => ({
        id,
        reason,
        note,
        createdAt: createdAt.toISOString(),
        preWeighingId,
      })),
      inputs: item.inputs.map(({ product, quantity, unitCost, leftovers }) => ({
        product: summaryOf(product),
        quantity: quantity.toString(),
        unitCost: unitCost?.toString() ?? null,
        leftovers: leftovers.map((leftover) => ({
          lotId: leftover.lotId,
          quantity: leftover.quantity.toString(),
          unitCost: leftover.unitCost.toString(),
        })),
      })),
    })),
  };
};

export type PresentedProduction = ReturnType<typeof presentProduction>;

// Thrown inside the transaction to undo what it already moved, and turned back into an answer
// outside of it.
export class ProductionAborted extends Error {
  constructor(readonly result: ProductionFailure) {
    super(result.message);
  }
}

// Holds the production row, as everything that changes its items does, and reads it as it stands
// once held: whatever held it before, such as a reduction of an item, has written by then.
export async function holdProduction(tx: Prisma.TransactionClient, id: string) {
  if (!(await lockProductionInProgress(tx, id))) {
    throw new ProductionAborted((await findProductionById(id, tx)) === null ? productionNotFound : notInProgress);
  }

  return (await findProductionById(id, tx))!;
}

// The items asked for, in the order of the production, when each is a pending item of it.
function chosenItems(production: ProductionRecord, ids: string[]): Result<ProductionItemRecord[], 409> {
  const wanted = new Set(ids.map((id) => id.toLowerCase()));
  const chosen = production.items.filter((item) => wanted.has(item.id));

  if (chosen.length !== wanted.size) return fail(409, "The items do not match the items of the production.");
  if (chosen.some((item) => item.status !== ProductionItemStatus.PENDING)) return notPending;

  return succeed(chosen);
}

// An item is made after the items of the production that make what it takes, so it cannot finish
// while one of them is pending, not even in the same call.
export function pendingDependencies(production: ProductionRecord, finishing: ProductionItemRecord[]) {
  const dependencies = dependencyItemsOf(production.items);
  const byId = new Map(production.items.map((item) => [item.id, item]));
  const waiting = finishing
    .map((item) => ({ item, waitsFor: waitingFor(item.id, dependencies) }))
    .filter(({ waitsFor }) => waitsFor.length > 0);

  if (waiting.length === 0) return null;

  return failWith(409, "An item waits for another item of the production.", {
    waitingFor: waiting.map(({ item, waitsFor }) => ({
      itemId: item.id,
      product: summaryOf(item.product),
      waitsFor: waitsFor.map((itemId) => ({ itemId, product: summaryOf(byId.get(itemId)!.product) })),
    })),
  });
}

// The inputs of an item are settled when the production starts, so what the operator is guided by
// is what leaves the stock when it finishes, whatever happens to the recipe in between.
export function itemFromPreWeighing(preWeighing: PreWeighingRecord): PlannedProductionItem {
  return {
    productSku: preWeighing.product.sku,
    preWeighingId: preWeighing.id,
    expectedQuantity: preWeighing.quantity,
    inputs: preWeighing.items.map(({ product, plannedQuantity, weighedQuantity }) => ({
      productSku: product.sku,
      // A line that was not weighed is guided by what was planned.
      quantity: weighedQuantity ?? plannedQuantity,
    })),
  };
}

const isPending = (preWeighing: PreWeighingRecord) =>
  preWeighingStatusOf({
    damaged: preWeighing.damage !== null,
    itemStatus: preWeighing.production?.status ?? null,
    extraItemStatus: preWeighing.productionWeighing?.productionItem.status ?? null,
  }) === "PENDING";

// The root and the pending pre-weighings under it. The tree comes depth-first, so a parent is seen
// before its children: one that is not pending cuts its branch.
async function guidedItems(rootId: string): Promise<Result<PlannedProductionItem[], 404 | 409>> {
  const [root, ...descendants] = await findPreWeighingTree(rootId);

  if (root === undefined) return fail(404, "Pre-weighing not found.");
  if (!(await isPendingStartRoot(rootId))) return fail(409, "The pre-weighing is not a pending root.");

  const kept = new Set([root.id]);

  for (const preWeighing of descendants) {
    if (isPending(preWeighing) && kept.has(preWeighing.parent!.id)) kept.add(preWeighing.id);
  }

  return succeed([root, ...descendants].filter(({ id }) => kept.has(id)).map(itemFromPreWeighing));
}

async function freeItem(request: {
  productSku: string;
  quantity: string;
}): Promise<Result<PlannedProductionItem, 404 | 409>> {
  const result = await planPreWeighing(request.productSku, request.quantity, undefined, { stages: false });

  if (!result.ok) return result;

  return succeed({
    productSku: result.data.product.sku,
    preWeighingId: null,
    expectedQuantity: result.data.quantity,
    inputs: result.data.items.map(({ product, plannedQuantity }) => ({
      productSku: product.sku,
      quantity: plannedQuantity,
    })),
  });
}

export async function startProduction(
  input: { createdById: string } & z.infer<typeof startProductionBodySchema>,
): Promise<ProductionResult> {
  const items: PlannedProductionItem[] = [];

  if ("preWeighingId" in input) {
    const guided = await guidedItems(input.preWeighingId);

    if (!guided.ok) return guided;

    items.push(...guided.data);
  } else {
    for (const request of input.items) {
      const result = await freeItem(request);

      if (!result.ok) return result;

      items.push(result.data);
    }
  }

  try {
    return succeed(presentProduction(await insertProduction({ createdById: input.createdById, items })));
  } catch (error) {
    // The only unique rule a new production can break is the one that gives a pre-weighing a
    // single item, and leaving it to the database is what holds under simultaneous requests.
    if (isUniqueViolation(error)) return fail(409, "A pre-weighing already guides another production.");

    throw error;
  }
}

/**
 * What concluding these items together would discard of the opened packagings, each taking what its
 * conclusion would, priced at each lot's cost. With no items, every pending one.
 */
export async function previewLeftovers(id: string, itemIds?: string[]) {
  const production = await findProductionById(id);

  if (production === null) return productionNotFound;
  if (production.status !== ProductionStatus.IN_PROGRESS) return notInProgress;

  const chosen =
    itemIds === undefined
      ? succeed(production.items.filter((item) => item.status === ProductionItemStatus.PENDING))
      : chosenItems(production, itemIds);

  if (!chosen.ok) return chosen;

  const concluding = chosen.data.map((item) => asConcluded(production.items, item));
  const items = (await previewProductionLeftovers(concluding, localToday())).map(({ itemId, leftovers }) => ({
    itemId,
    leftovers: leftovers.map(({ product, lotId, quantity, unitCost }) => ({
      product: summaryOf(product),
      lotId,
      quantity: quantity.toString(),
      unitCost: unitCost.toString(),
      cost: quantity.mul(unitCost).toFixed(2),
    })),
  }));
  const total = Prisma.Decimal.sum(
    0,
    ...items.flatMap(({ leftovers }) =>
      leftovers.map(({ quantity, unitCost }) => new Prisma.Decimal(quantity).mul(unitCost)),
    ),
  );

  return succeed({ items, totalCost: total.toFixed(2) });
}

// An item went wrong before it finished, such as a filling that burnt: what it took leaves the
// stock as losses under the reason given, and nothing comes in. It is refused where a finish would
// be, since it uses up the same inputs: the production is held as a finish holds it, so one of them
// sees what the other wrote.
export async function damageProductionItem(input: {
  productionId: string;
  itemId: string;
  reasonId: string;
  note?: string | null;
  createdById: string;
}): Promise<ProductionResult> {
  const { productionId, itemId, reasonId, createdById } = input;
  const note = input.note ?? null;

  try {
    const today = localToday();

    await inProductionTransaction(async (tx) => {
      const production = await holdProduction(tx, productionId);
      const item = production.items.find((found) => found.id === itemId.toLowerCase());

      if (item === undefined) throw new ProductionAborted(itemNotFound);
      if (item.status !== ProductionItemStatus.PENDING) throw new ProductionAborted(notPending);
      if (hasBatches(item)) throw new ProductionAborted(itemHasBatches);
      if (awaitsWeighing(item)) throw new ProductionAborted(awaitsNewWeighing);

      const waiting = pendingDependencies(production, [item]);

      if (waiting !== null) throw new ProductionAborted(waiting);

      // Every balance the write-off moves is held before any moves, in the order a finish holds them.
      await holdStockBalances(
        tx,
        item.inputs.map(({ product }) => product.sku),
      );
      await holdReasonInUse(tx, reasonId);

      const damage = await insertItemDamage(tx, {
        itemId: item.id,
        preWeighingId: item.preWeighingId,
        reasonId,
        note,
        createdById,
      });

      for (const { product, quantity } of item.inputs) {
        await writeOffForDamage(tx, {
          productSku: product.sku,
          quantity,
          damageId: damage.id,
          reasonId,
          note,
          createdById,
          today,
        });
      }
    });
  } catch (error) {
    if (error instanceof ProductionAborted) return error.result;
    if (error instanceof RefusedReason) {
      const { status, message } = REASON_FAILURES[error.failure];

      return fail(status, message);
    }

    throw error;
  }

  return succeed(presentProduction((await findProductionById(productionId))!));
}

// Batches and extra weighings are what the operator really made: a damage or a substitution would
// throw them away.
const hasBatches = (item: ProductionItemRecord) => item.batches.length > 0 || item.extraWeighings.length > 0;

const itemHasBatches = fail(409, "The item already has batches.");

const notIntermediate = fail(409, "Only an intermediate can be substituted.");

// An intermediate is an item another item of the production takes, in any state; the item must still
// be pending to be resolved from stock.
function substitutable(production: ProductionRecord, itemId: string): Result<ProductionItemRecord, 404 | 409> {
  const item = production.items.find((found) => found.id === itemId.toLowerCase());

  if (item === undefined) return itemNotFound;
  if (item.status !== ProductionItemStatus.PENDING) return notPending;
  if (hasBatches(item)) return itemHasBatches;

  return isTakenByAnother(production.items, item) ? succeed(item) : notIntermediate;
}

/** The stock of an intermediate against what the pending items of the production take of it. */
export async function previewSubstitution(input: { productionId: string; itemId: string }) {
  const production = await findProductionById(input.productionId);

  if (production === null) return productionNotFound;
  if (production.status !== ProductionStatus.IN_PROGRESS) return notInProgress;

  const item = substitutable(production, input.itemId);

  if (!item.ok) return item;

  const { product } = item.data;
  const needed = Prisma.Decimal.sum(
    0,
    ...production.items
      .filter(({ status }) => status === ProductionItemStatus.PENDING)
      .flatMap(({ inputs }) =>
        inputs.filter((line) => line.product.sku === product.sku).map(({ quantity }) => quantity),
      ),
  );

  return succeed({
    product: summaryOf(product),
    needed: needed.toString(),
    available: (await readStockBalance(product.sku)).toString(),
  });
}

// The operator resolves an intermediate with stock of the same product instead of making it: nothing
// moves, and the item that takes it consumes from stock at its own finish, under the shortage check.
export async function substituteProductionItem(input: {
  productionId: string;
  itemId: string;
}): Promise<ProductionResult> {
  const { productionId, itemId } = input;

  try {
    await inProductionTransaction(async (tx) => {
      const item = substitutable(await holdProduction(tx, productionId), itemId);

      if (!item.ok) throw new ProductionAborted(item);

      await markItemSubstituted(tx, item.data.id);
      await closeIfResolved(tx, productionId);
    });
  } catch (error) {
    if (error instanceof ProductionAborted) return error.result;

    throw error;
  }

  return succeed(presentProduction((await findProductionById(productionId))!));
}

export async function getProduction(id: string): Promise<Result<PresentedProduction, 404>> {
  const production = await findProductionById(id);

  if (production === null) return productionNotFound;

  return succeed(presentProduction(production));
}

export async function listProductionsPage(query: { status?: ProductionStatus; limit: number; cursor?: string }) {
  const { items, nextCursor } = toPage(await listProductions(query), query);

  return { items: items.map(presentProduction), nextCursor };
}
