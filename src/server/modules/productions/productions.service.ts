import type { z } from "zod";
import { MeasurementUnit, Prisma, ProductionItemStatus, ProductionStatus, ProductKind } from "@prisma/client";
import { localToday } from "@/server/lib/dates";
import { fitsPlacesOf, TOO_MANY_PLACES, toStoredDecimal } from "@/server/lib/decimal";
import { toPage } from "@/server/lib/pagination";
import { isUniqueViolation } from "@/server/lib/prisma-errors";
import { fail, failWith, succeed, type Failure, type Result } from "@/server/lib/result";
import {
  findPreWeighingParentId,
  findPreWeighingTree,
  insertPreWeighingTree,
  isPendingStartRoot,
} from "@/server/modules/pre-weighings/pre-weighings.repository";
import type { PreWeighingRecord } from "@/server/modules/pre-weighings/pre-weighings.repository";
import { preWeighingStatusOf } from "@/server/modules/pre-weighings/pre-weighing-status";
import {
  PARENT_DOES_NOT_TAKE,
  planPreWeighing,
  preparePreWeighing,
  type StageBody,
} from "@/server/modules/pre-weighings/pre-weighings.service";
import { holdReasonInUse, RefusedReason } from "@/server/modules/losses/losses.repository";
import { REASON_FAILURES } from "@/server/modules/losses/losses.service";
import { holdStockBalances, readStockBalance } from "@/server/modules/stock/stock.repository";
import {
  addProductionItems,
  closeIfResolved,
  consumeProductionInput,
  discardLeftover,
  findProductionById,
  inProductionTransaction,
  insertItemDamage,
  insertProduction,
  listProductions,
  lockProductionInProgress,
  markItemSubstituted,
  markProductionCanceled,
  outputProductionItem,
  previewProductionLeftovers,
  releasePreWeighings,
  reguideProductionItem,
  rescaleProductionItem,
  writeOffForDamage,
} from "./productions.repository";
import type { PlannedProductionItem, ProductionRecord } from "./productions.repository";
import type { startProductionBodySchema } from "./productions.schemas";
import { dependenciesOf, waitingFor, type DependencyItem } from "./production-dependencies";
import { leftoverOf, splitLeftover } from "./production-leftovers";
import { maxQuantityFromStock, scaleInputs } from "./production-reduction";

type ProductionFailure = Failure<404 | 409>;
type ProductionResult = Result<PresentedProduction, 404 | 409>;

const notFound = fail(404, "Production not found.");
const notInProgress = fail(409, "Production is not in progress.");
const notPending = fail(409, "The item is not pending.");
const itemNotFound = fail(404, "Production item not found.");
const awaitsNewWeighing = fail(409, "The item waits for a new weighing.");

type ProductionItemRecord = ProductionRecord["items"][number];

const summaryOf = ({ sku, description, unit }: { sku: string; description: string; unit: MeasurementUnit }) => ({
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

// A damage that named the pre-weighing of a guided item took it away: it cannot be made again until
// a new weighing is recorded for it. A free item damaged keeps its inputs, ready to be made again.
const awaitsWeighing = (item: ProductionItemRecord) =>
  item.preWeighingId === null && item.damages.some((damage) => damage.preWeighingId !== null);

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

// A lot with a packaging that inputs which cannot be kept once opened took from, as it stood before
// the first of them: what is left of the packagings opened is worked out from it once all have taken.
type OpenedLot = {
  lotId: string;
  productSku: string;
  lotQuantity: Prisma.Decimal;
  content: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  takes: { itemId: string; inputId: string; taken: Prisma.Decimal }[];
};

function openedBy(
  opened: Map<string, OpenedLot>,
  input: { itemId: string; inputId: string; productSku: string },
  takes: Awaited<ReturnType<typeof consumeProductionInput>>["takes"],
) {
  for (const { lotId, quantity, unitCost, lotQuantity, packageContent } of takes) {
    if (lotId === null || lotQuantity === null || packageContent === null) continue;

    const lot = opened.get(lotId) ?? {
      lotId,
      productSku: input.productSku,
      lotQuantity,
      content: packageContent,
      unitCost,
      takes: [],
    };

    lot.takes.push({ itemId: input.itemId, inputId: input.inputId, taken: quantity });
    opened.set(lotId, lot);
  }
}

// Thrown inside the transaction to undo what it already moved, and turned back into an answer
// outside of it.
class ProductionAborted extends Error {
  constructor(readonly result: ProductionFailure) {
    super(result.message);
  }
}

// Holds the production row, as everything that changes its items does, and reads it as it stands
// once held: whatever held it before, such as a reduction of an item, has written by then.
async function holdProduction(tx: Prisma.TransactionClient, id: string) {
  if (!(await lockProductionInProgress(tx, id))) {
    throw new ProductionAborted((await findProductionById(id, tx)) === null ? notFound : notInProgress);
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
function pendingDependencies(production: ProductionRecord, finishing: ProductionItemRecord[]) {
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

// Nothing holds an intermediate for the product that takes it, so the stock of each one is checked
// against what the items finishing take of it together, with the balances already held. Bought
// products keep letting the balance go negative.
function intermediateShortage(
  finishing: ProductionItemRecord[],
  balances: { productSku: string; quantity: Prisma.Decimal }[],
) {
  const available = new Map(balances.map(({ productSku, quantity }) => [productSku.toLowerCase(), quantity]));
  const needed = new Map<string, Prisma.Decimal>();

  for (const item of finishing) {
    for (const { product, quantity } of item.inputs) {
      if (product.kind !== ProductKind.MANUFACTURED) continue;

      needed.set(product.sku, (needed.get(product.sku) ?? new Prisma.Decimal(0)).add(quantity));
    }
  }

  const availableOf = (sku: string) => available.get(sku.toLowerCase()) ?? new Prisma.Decimal(0);
  const isShort = (sku: string) => needed.has(sku) && needed.get(sku)!.gt(availableOf(sku));
  const shortages = [];
  const items = [];

  for (const item of finishing) {
    const short = item.inputs.filter(
      ({ product }) => product.kind === ProductKind.MANUFACTURED && isShort(product.sku),
    );

    if (short.length === 0) continue;

    for (const { product, quantity } of short) {
      shortages.push({
        itemId: item.id,
        product: summaryOf(product),
        needed: quantity.toString(),
        available: availableOf(product.sku).toString(),
      });
    }

    const maxQuantity = maxQuantityFromStock({
      expected: item.expectedQuantity,
      unit: item.product.unit,
      // Items that share a short product share its stock, each by the part of the need it takes.
      needs: short.map(({ product, quantity }) => ({
        needed: quantity,
        available: availableOf(product.sku).mul(quantity).div(needed.get(product.sku)!),
      })),
    });

    items.push({ itemId: item.id, maxQuantity: maxQuantity.toString() });
  }

  if (shortages.length === 0) return null;

  return failWith(409, "Not enough of an intermediate in stock.", { shortages, items });
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
  preWeighingStatusOf({ damaged: preWeighing.damage !== null, itemStatus: preWeighing.production?.status ?? null }) ===
  "PENDING";

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

// Finishing is where the stock moves: every input of the items finished leaves the lots that expire
// first, at what each of them cost, and each product comes in as a lot costing what its inputs
// cost, spread over what was really produced. The production ends with its last pending item.
export async function finishProduction(input: {
  id: string;
  createdById: string;
  items: { id: string; producedQuantity: string; expiresAt: string | null }[];
  hasLeftoversInCost?: boolean;
}): Promise<ProductionResult> {
  const { id, createdById, hasLeftoversInCost = true } = input;
  const producedById = new Map(input.items.map((item) => [item.id.toLowerCase(), item]));

  try {
    const today = localToday();

    await inProductionTransaction(async (tx) => {
      const production = await holdProduction(tx, id);
      const chosen = chosenItems(
        production,
        input.items.map((item) => item.id),
      );

      if (!chosen.ok) throw new ProductionAborted(chosen);

      const finishing = chosen.data;

      if (finishing.some(awaitsWeighing)) throw new ProductionAborted(awaitsNewWeighing);

      const waiting = pendingDependencies(production, finishing);

      if (waiting !== null) throw new ProductionAborted(waiting);

      const balances = await holdStockBalances(
        tx,
        finishing.flatMap((item) => [item.product.sku, ...item.inputs.map((input) => input.product.sku)]),
      );
      const refusal = intermediateShortage(finishing, balances);

      if (refusal !== null) throw new ProductionAborted(refusal);

      // Every item finishing takes its inputs first: the items finished together are made together,
      // so they share the packagings they open, and what is left of them is only known once all have
      // taken. Items finished in another call close their own.
      const costs = new Map(finishing.map((item) => [item.id, new Prisma.Decimal(0)]));
      const opened = new Map<string, OpenedLot>();

      for (const item of finishing) {
        for (const { id: inputId, product, quantity } of item.inputs) {
          const { cost, takes } = await consumeProductionInput(tx, {
            id: inputId,
            productSku: product.sku,
            quantity,
            createdById,
            today,
          });

          costs.set(item.id, costs.get(item.id)!.add(cost));

          if (!product.isStorableOnceOpened)
            openedBy(opened, { itemId: item.id, inputId, productSku: product.sku }, takes);
        }
      }

      for (const lot of opened.values()) {
        const taken = Prisma.Decimal.sum(0, ...lot.takes.map((take) => take.taken));
        const left = leftoverOf(lot.lotQuantity, taken, lot.content);

        for (const share of splitLeftover(left, lot.takes)) {
          const { itemId } = lot.takes.find((take) => take.inputId === share.inputId)!;

          await discardLeftover(tx, {
            inputId: share.inputId,
            lotId: lot.lotId,
            productSku: lot.productSku,
            quantity: share.quantity,
            unitCost: lot.unitCost,
            createdById,
          });

          if (hasLeftoversInCost) costs.set(itemId, costs.get(itemId)!.add(share.quantity.mul(lot.unitCost)));
        }
      }

      for (const item of finishing) {
        const { producedQuantity, expiresAt } = producedById.get(item.id)!;
        const unitCost = toStoredDecimal(costs.get(item.id)!.div(producedQuantity));

        if (unitCost === null) {
          throw new ProductionAborted(fail(409, "Produced quantity is out of range for the cost of the inputs."));
        }

        await outputProductionItem(tx, {
          id: item.id,
          productSku: item.product.sku,
          quantity: producedQuantity,
          unitCost,
          expiresAt,
          hasLeftoversInCost,
          createdById,
        });
      }

      await closeIfResolved(tx, id);
    });
  } catch (error) {
    if (error instanceof ProductionAborted) return error.result;

    throw error;
  }

  return succeed(presentProduction((await findProductionById(id))!));
}

/**
 * What finishing these items together would discard of the opened packagings, priced at each lot's
 * cost. With no items, every pending one.
 */
export async function previewLeftovers(id: string, itemIds?: string[]) {
  const production = await findProductionById(id);

  if (production === null) return notFound;
  if (production.status !== ProductionStatus.IN_PROGRESS) return notInProgress;

  const chosen =
    itemIds === undefined
      ? succeed(production.items.filter((item) => item.status === ProductionItemStatus.PENDING))
      : chosenItems(production, itemIds);

  if (!chosen.ok) return chosen;

  const items = (await previewProductionLeftovers(chosen.data, localToday())).map(({ itemId, leftovers }) => ({
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

// A production moves the stock only when its items finish, so giving one up has nothing to put
// back: the items already finished keep their lots and their pre-weighings, and only the pending
// ones let go of theirs.
export async function cancelProduction(id: string): Promise<ProductionResult> {
  if ((await findProductionById(id)) === null) return notFound;

  const canceled = await inProductionTransaction(async (tx) => {
    if (!(await markProductionCanceled(tx, id))) return false;

    await releasePreWeighings(tx, id);

    return true;
  });

  if (!canceled) return notInProgress;

  return succeed(presentProduction((await findProductionById(id))!));
}

// The yield an item is expected to have came out lower than planned: its inputs follow it in the
// same proportion. The pre-weighing that guided it stays as it was weighed. The production is held
// from the check that it is in progress until the item is written, so it cannot finish or be
// canceled in between.
export async function reduceProductionItem(input: {
  productionId: string;
  itemId: string;
  quantity: string;
}): Promise<ProductionResult> {
  const { productionId, itemId } = input;
  const quantity = new Prisma.Decimal(input.quantity);

  try {
    await inProductionTransaction(async (tx) => {
      const item = (await holdProduction(tx, productionId)).items.find((found) => found.id === itemId.toLowerCase());

      if (item === undefined) throw new ProductionAborted(itemNotFound);
      // What a finished item took already left the stock: its quantities are history.
      if (item.status !== ProductionItemStatus.PENDING) throw new ProductionAborted(notPending);
      if (quantity.gte(item.expectedQuantity)) {
        throw new ProductionAborted(fail(409, "The quantity must be less than the expected quantity."));
      }
      if (!fitsPlacesOf(quantity, item.product.unit)) {
        throw new ProductionAborted(fail(409, TOO_MANY_PLACES));
      }

      const inputs = scaleInputs(item.inputs, item.expectedQuantity, quantity);

      if (inputs === null) throw new ProductionAborted(fail(409, "Quantity is out of range for this recipe."));

      await rescaleProductionItem(tx, { id: itemId, expectedQuantity: quantity, inputs });
    });
  } catch (error) {
    if (error instanceof ProductionAborted) return error.result;

    throw error;
  }

  return succeed(presentProduction((await findProductionById(productionId))!));
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

const notIntermediate = fail(409, "Only an intermediate can be substituted.");

// An intermediate is an item another item of the production takes, in any state; the item must still
// be pending to be resolved from stock.
function substitutable(production: ProductionRecord, itemId: string): Result<ProductionItemRecord, 404 | 409> {
  const item = production.items.find((found) => found.id === itemId.toLowerCase());

  if (item === undefined) return itemNotFound;
  if (item.status !== ProductionItemStatus.PENDING) return notPending;

  const isTaken = production.items.some(
    (other) => other.id !== item.id && other.inputs.some(({ product }) => product.sku === item.product.sku),
  );

  return isTaken ? succeed(item) : notIntermediate;
}

/** The stock of an intermediate against what the pending items of the production take of it. */
export async function previewSubstitution(input: { productionId: string; itemId: string }) {
  const production = await findProductionById(input.productionId);

  if (production === null) return notFound;
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

  if (production === null) return notFound;

  return succeed(presentProduction(production));
}

export async function listProductionsPage(query: { status?: ProductionStatus; limit: number; cursor?: string }) {
  const { items, nextCursor } = toPage(await listProductions(query), query);

  return { items: items.map(presentProduction), nextCursor };
}

const doesNotAwaitWeighing = fail(409, "The item does not wait for a new weighing.");
const parentNotPending = fail(409, "The parent is not a pending item of the production.");

// Where a new weighing goes in the production, and in the tree of pre-weighings. For an item a damage
// left waiting, it guides that item and is recorded where the damaged pre-weighing was; for a
// complement, it goes under the pre-weighing of a pending item that takes its product.
async function placeWeighing(
  tx: Prisma.TransactionClient,
  production: ProductionRecord,
  input: { itemId?: string; parentId?: string; productSku: string },
): Promise<{ item: ProductionItemRecord | null; parentId: string | null }> {
  const productSku = input.productSku.toLowerCase();

  if (input.itemId !== undefined) {
    const item = production.items.find((found) => found.id === input.itemId!.toLowerCase());

    if (item === undefined) throw new ProductionAborted(itemNotFound);
    if (item.status !== ProductionItemStatus.PENDING) throw new ProductionAborted(notPending);
    if (!awaitsWeighing(item)) throw new ProductionAborted(doesNotAwaitWeighing);
    if (item.product.sku !== productSku) throw new ProductionAborted(fail(409, "The product does not match the item."));

    const damaged = item.damages.filter((damage) => damage.preWeighingId !== null).at(-1)!;

    return { item, parentId: (await findPreWeighingParentId(damaged.preWeighingId!, tx)) ?? null };
  }

  const parentId = input.parentId!.toLowerCase();
  const parent = production.items.find(
    (found) => found.preWeighingId === parentId && found.status === ProductionItemStatus.PENDING,
  );

  if (parent === undefined) throw new ProductionAborted(parentNotPending);
  if (!parent.inputs.some(({ product }) => product.sku === productSku)) {
    throw new ProductionAborted(fail(409, PARENT_DOES_NOT_TAKE));
  }

  return { item: null, parentId };
}

// A pre-weighing recorded inside a production in progress, in the same transaction as what it changes
// there, with the production held: it cannot interleave with a finish, a damage or a cancel. Each stage
// of what is recorded joins the production as an item of its own; the root guides the item that waits
// for it, or joins too as a complement. The plan depends only on what was sent, the recipes and the
// stock, so it is worked out before the production is held, which keeps the hold short.
export async function recordProductionWeighing(input: {
  productionId: string;
  createdById: string;
  itemId?: string;
  parentId?: string;
  tree: StageBody;
}): Promise<ProductionResult> {
  const { productionId, createdById, tree } = input;
  const planned = await preparePreWeighing(tree);

  if (!planned.ok) return planned;

  try {
    await inProductionTransaction(async (tx) => {
      const production = await holdProduction(tx, productionId);
      const place = await placeWeighing(tx, production, { ...input, productSku: tree.productSku });
      const { id } = await insertPreWeighingTree(planned.data, { createdById, parentId: place.parentId }, tx);
      // The tree comes root first, and the root was just written.
      const [root, ...stages] = (await findPreWeighingTree(id, tx)).map(itemFromPreWeighing) as [
        PlannedProductionItem,
        ...PlannedProductionItem[],
      ];

      if (place.item === null) {
        await addProductionItems(tx, productionId, [root, ...stages]);
      } else {
        await reguideProductionItem(tx, place.item.id, root);
        await addProductionItems(tx, productionId, stages);
      }
    });
  } catch (error) {
    if (error instanceof ProductionAborted) return error.result;

    throw error;
  }

  return succeed(presentProduction((await findProductionById(productionId))!));
}
