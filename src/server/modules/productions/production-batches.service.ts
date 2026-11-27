import { Prisma, ProductionItemStatus, ProductKind } from "@prisma/client";
import { localToday, toOptionalDateString } from "@/server/lib/dates";
import { fitsPlacesOf, TOO_MANY_PLACES, toStoredDecimal } from "@/server/lib/decimal";
import { fail, failWith, succeed } from "@/server/lib/result";
import {
  findPreWeighingParentId,
  insertPreWeighingTree,
} from "@/server/modules/pre-weighings/pre-weighings.repository";
import { preparePreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";
import { repriceProduct } from "@/server/modules/pricing/pricing.service";
import { holdStockBalances } from "@/server/modules/stock/stock.repository";
import type { ProductionBatchSource } from "@/shared/enums";
import { asConcluded, lotsOf, madeOf, producedOf } from "./production-batches";
import { leftoverOf, splitLeftover } from "./production-leftovers";
import { maxQuantityFromStock } from "./production-reduction";
import {
  addItemWeighing,
  addProductionItems,
  closeIfResolved,
  consumeProductionInput,
  deleteItemBatch,
  discardLeftover,
  enterProducedLot,
  findProductionById,
  inProductionTransaction,
  insertItemBatch,
  markItemConcluded,
  markProductionCanceled,
  reguideProductionItem,
  releasePreWeighings,
  type ProductionRecord,
} from "./productions.repository";
import { BATCH_EXPIRED } from "./productions.schemas";
import {
  awaitsNewWeighing,
  awaitsWeighing,
  holdProduction,
  itemFromPreWeighing,
  itemNotFound,
  notPending,
  pendingDependencies,
  presentProduction,
  ProductionAborted,
  productionNotFound,
  summaryOf,
  type ProductionItemRecord,
  type ProductionResult,
} from "./productions.service";

const batchNotFound = fail(404, "Batch not found.");

async function inHeldProduction(productionId: string, work: Parameters<typeof inProductionTransaction>[0]) {
  try {
    await inProductionTransaction(work);
  } catch (error) {
    if (error instanceof ProductionAborted) return error.result;

    throw error;
  }

  return succeed(presentProduction((await findProductionById(productionId))!));
}

// What the operator made of an item, one batch at a time. It is refused where a finish would be:
// an item is made after what it takes, and not while it waits for a new weighing.
export function recordBatch(input: {
  productionId: string;
  itemId: string;
  quantity: string;
  expiresAt: string | null;
  source: ProductionBatchSource;
  createdById: string;
}): Promise<ProductionResult> {
  const { productionId, itemId, quantity, expiresAt, source, createdById } = input;

  return inHeldProduction(productionId, async (tx) => {
    const production = await holdProduction(tx, productionId);
    const item = production.items.find((found) => found.id === itemId.toLowerCase());

    if (item === undefined) throw new ProductionAborted(itemNotFound);
    if (item.status !== ProductionItemStatus.PENDING) throw new ProductionAborted(notPending);
    if (awaitsWeighing(item)) throw new ProductionAborted(awaitsNewWeighing);

    const waiting = pendingDependencies(production, [item]);

    if (waiting !== null) throw new ProductionAborted(waiting);
    if (!fitsPlacesOf(new Prisma.Decimal(quantity), item.product.unit)) {
      throw new ProductionAborted(fail(409, TOO_MANY_PLACES));
    }

    await insertItemBatch(tx, { itemId: item.id, quantity, expiresAt, source, createdById });
  });
}

// Fixing a typo: a batch goes while its item is pending, and nothing else of the item changes.
export function removeBatch(input: {
  productionId: string;
  itemId: string;
  batchId: string;
}): Promise<ProductionResult> {
  const { productionId, itemId, batchId } = input;

  return inHeldProduction(productionId, async (tx) => {
    const item = (await holdProduction(tx, productionId)).items.find((found) => found.id === itemId.toLowerCase());

    if (item === undefined) throw new ProductionAborted(itemNotFound);
    if (item.status !== ProductionItemStatus.PENDING) throw new ProductionAborted(notPending);

    const batch = item.batches.find((found) => found.id === batchId.toLowerCase());

    if (batch === undefined) throw new ProductionAborted(batchNotFound);

    await deleteItemBatch(tx, batch.id);
  });
}

// A weighing of an item goes in the tree of pre-weighings where the item's own is, or was before a
// damage took it away; an item that never had one is weighed at the root of a tree of its own.
async function parentOfWeighing(tx: Prisma.TransactionClient, item: ProductionItemRecord) {
  const damaged = item.damages.filter((damage) => damage.preWeighingId !== null).at(-1);
  const sibling = item.preWeighingId ?? damaged?.preWeighingId ?? null;

  return sibling === null ? null : ((await findPreWeighingParentId(sibling, tx)) ?? null);
}

// Every weighing inside a production is of one of its items. An item that waits for a weighing, after
// a damage or added for a shortage, is guided by it; any other takes it as one more batch to make, and
// what it weighed adds to what the item takes. The plan depends only on what was sent, the recipe and
// the stock, so it is worked out before the production is held, which keeps the hold short.
export async function weighItem(input: {
  productionId: string;
  itemId: string;
  quantity: string;
  items: { productSku: string; weighedQuantity?: string }[];
  createdById: string;
}): Promise<ProductionResult> {
  const { productionId, quantity, items, createdById } = input;
  const production = await findProductionById(productionId);

  if (production === null) return productionNotFound;

  const itemId = input.itemId.toLowerCase();
  const found = production.items.find((item) => item.id === itemId);

  if (found === undefined) return itemNotFound;

  // Intermediates of the recipe are taken from stock: a weighing inside a production has no stages.
  const planned = await preparePreWeighing({ productSku: found.product.sku, quantity, items, stages: [] });

  if (!planned.ok) return planned;

  return inHeldProduction(productionId, async (tx) => {
    const held = await holdProduction(tx, productionId);
    // An item is never removed from its production.
    const item = held.items.find((other) => other.id === itemId)!;

    if (item.status !== ProductionItemStatus.PENDING) throw new ProductionAborted(notPending);

    const waiting = pendingDependencies(held, [item]);

    if (waiting !== null) throw new ProductionAborted(waiting);

    const parentId = await parentOfWeighing(tx, item);
    const weighed = itemFromPreWeighing(await insertPreWeighingTree(planned.data, { createdById, parentId }, tx));

    if (awaitsWeighing(item)) {
      await reguideProductionItem(tx, item.id, weighed);
    } else {
      await addItemWeighing(tx, item.id, { preWeighingId: weighed.preWeighingId!, inputs: weighed.inputs });
    }
  });
}

const notIntermediate = fail(409, "Only an intermediate of the production can be added.");

// What the shortage of an intermediate asks for: one more item of it, expected to yield what is
// missing, with nothing to make it from until it is weighed.
export function addShortageItem(input: {
  productionId: string;
  productSku: string;
  quantity: string;
}): Promise<ProductionResult> {
  const { productionId, quantity } = input;
  const productSku = input.productSku.toLowerCase();

  return inHeldProduction(productionId, async (tx) => {
    const production = await holdProduction(tx, productionId);
    // Only what a pending item still has to be made from can be short: an intermediate it takes.
    const taken = production.items
      .filter((item) => item.status === ProductionItemStatus.PENDING)
      .flatMap((item) => item.inputs)
      .find(({ product }) => product.sku === productSku && product.kind === ProductKind.MANUFACTURED);

    if (taken === undefined) throw new ProductionAborted(notIntermediate);
    if (!fitsPlacesOf(new Prisma.Decimal(quantity), taken.product.unit)) {
      throw new ProductionAborted(fail(409, TOO_MANY_PLACES));
    }

    await addProductionItems(tx, productionId, [
      { productSku, preWeighingId: null, expectedQuantity: new Prisma.Decimal(quantity), inputs: [] },
    ]);
  });
}

const ZERO = new Prisma.Decimal(0);

const noBatch = fail(409, "The item has no batch.");
const batchExpired = fail(409, BATCH_EXPIRED);
const belowItsTarget = fail(409, "The item is below its target.");
const costOutOfRange = fail(409, "Produced quantity is out of range for the cost of the inputs.");

type HeldBalance = Awaited<ReturnType<typeof holdStockBalances>>[number];

// Every balance concluding these items moves: what they take and what they make.
const balancesMovedBy = (items: ProductionItemRecord[]) =>
  items.flatMap((item) => [item.product.sku, ...item.inputs.map(({ product }) => product.sku)]);

const balanceOf = (balances: HeldBalance[], productSku: string) =>
  balances.find((balance) => balance.productSku.toLowerCase() === productSku.toLowerCase())?.quantity ?? ZERO;

// An intermediate concluded below its target: what it made, added to what the stock has of it and to
// what the other pending items of the same product are to make, must still cover what the pending
// items that take it need, or the gap is closed where it happens.
function takersShortage(production: ProductionRecord, item: ProductionItemRecord, balances: HeldBalance[]) {
  const others = production.items.filter(
    (other) => other.id !== item.id && other.status === ProductionItemStatus.PENDING,
  );
  const needed = Prisma.Decimal.sum(
    0,
    ...others
      .flatMap(({ inputs }) => inputs.filter(({ product }) => product.sku === item.product.sku))
      .map(({ quantity }) => quantity),
  );
  const toMake = Prisma.Decimal.sum(
    0,
    ...others.filter(({ product }) => product.sku === item.product.sku).map(({ expectedQuantity }) => expectedQuantity),
  );
  const available = balanceOf(balances, item.product.sku).add(producedOf(item.batches)).add(toMake);

  if (needed.lte(available)) return null;

  return failWith(409, "An intermediate would fall short.", {
    missing: [{ product: summaryOf(item.product), quantity: needed.sub(available).toString() }],
  });
}

// Nothing holds an intermediate for the product that takes it, so the stock of each one is checked
// against what the items concluding take of it together, with the balances already held. Bought
// products keep letting the balance go negative.
function intermediateShortage(concluding: ProductionItemRecord[], balances: HeldBalance[]) {
  const needed = new Map<string, Prisma.Decimal>();

  for (const item of concluding) {
    for (const { product, quantity } of item.inputs) {
      if (product.kind !== ProductKind.MANUFACTURED) continue;

      needed.set(product.sku, (needed.get(product.sku) ?? ZERO).add(quantity));
    }
  }

  const availableOf = (sku: string) => balanceOf(balances, sku);
  const isShort = (sku: string) => needed.has(sku) && needed.get(sku)!.gt(availableOf(sku));
  const shortages = [];
  const items = [];

  for (const item of concluding) {
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

// A lot with a packaging that inputs which cannot be kept once opened took from, as it stood before
// the first of them: what is left of the packagings opened is worked out from it once all have taken.
type OpenedLot = {
  lotId: string;
  productSku: string;
  lotQuantity: Prisma.Decimal;
  content: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  takes: { inputId: string; taken: Prisma.Decimal }[];
};

function openedBy(
  opened: Map<string, OpenedLot>,
  input: { inputId: string; productSku: string },
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

    lot.takes.push({ inputId: input.inputId, taken: quantity });
    opened.set(lotId, lot);
  }
}

// Every input leaves the lots that expire first, at what each of them cost. What is left of the
// packagings opened of a product that cannot be kept once opened is discarded once all have taken.
// Answers what it all cost, the leftovers only when they go into the cost.
async function takeInputs(
  tx: Prisma.TransactionClient,
  item: ProductionItemRecord,
  { hasLeftoversInCost, createdById, today }: { hasLeftoversInCost: boolean; createdById: string; today: string },
) {
  let cost = ZERO;
  const opened = new Map<string, OpenedLot>();

  for (const { id: inputId, product, quantity } of item.inputs) {
    const consumed = await consumeProductionInput(tx, {
      id: inputId,
      productSku: product.sku,
      quantity,
      createdById,
      today,
    });

    cost = cost.add(consumed.cost);

    if (!product.isStorableOnceOpened) openedBy(opened, { inputId, productSku: product.sku }, consumed.takes);
  }

  for (const lot of opened.values()) {
    const taken = Prisma.Decimal.sum(0, ...lot.takes.map((take) => take.taken));

    for (const share of splitLeftover(leftoverOf(lot.lotQuantity, taken, lot.content), lot.takes)) {
      await discardLeftover(tx, {
        inputId: share.inputId,
        lotId: lot.lotId,
        productSku: lot.productSku,
        quantity: share.quantity,
        unitCost: lot.unitCost,
        createdById,
      });

      if (hasLeftoversInCost) cost = cost.add(share.quantity.mul(lot.unitCost));
    }
  }

  return cost;
}

// Concluding is where the stock moves: what the item took leaves the stock for what was made now,
// and its batches come in as lots, one per expiry. What was made costs everything that left spread
// over it; what already existed comes in at what the product costs on average, nothing when it never
// had a cost. A cost of what was made that the stock cannot hold is refused, or, where nothing may be
// refused, taken as the average cost too. Run with the production held, after whatever refusal applies.
async function concludeHeld(
  tx: Prisma.TransactionClient,
  production: ProductionRecord,
  item: ProductionItemRecord,
  options: {
    hasLeftoversInCost: boolean;
    createdById: string;
    today: string;
    costOutOfRange: "refuse" | "averageCost";
  },
) {
  const { hasLeftoversInCost, createdById } = options;
  const cost = await takeInputs(tx, asConcluded(production.items, item), options);
  const made = madeOf(item.batches);
  const fitting = made.gt(0) ? toStoredDecimal(cost.div(made)) : null;

  if (made.gt(0) && fitting === null && options.costOutOfRange === "refuse") {
    throw new ProductionAborted(costOutOfRange);
  }

  // Read once what was made is costed, before anything of the product comes in.
  const [balance] = await holdStockBalances(tx, [item.product.sku]);
  const averageCost = balance?.averageCost ?? ZERO;
  const madeCost = made.gt(0) ? (fitting ?? averageCost) : null;
  const batches = item.batches.map(({ quantity, expiresAt, source }) => ({
    quantity,
    source,
    expiresAt: toOptionalDateString(expiresAt),
  }));
  const productSku = item.product.sku;
  let entered = false;

  for (const { expiresAt, produced, existing } of lotsOf(batches)) {
    if (produced.gt(0)) {
      await enterProducedLot(tx, { productSku, quantity: produced, unitCost: madeCost!, expiresAt, createdById });
    }
    if (existing.gt(0)) {
      await enterProducedLot(tx, { productSku, quantity: existing, unitCost: averageCost, expiresAt, createdById });
    }
    entered = true;
  }

  if (entered) await repriceProduct(tx, { productSku, today: options.today });

  await markItemConcluded(tx, {
    id: item.id,
    producedQuantity: producedOf(item.batches),
    unitCost: madeCost ?? averageCost,
    hasLeftoversInCost,
  });
}

// An item is concluded with what its batches add up to, refused where recording a batch is and while
// a batch's expiry has passed. Below its target it must be meant, and an intermediate must still cover the items that take it; what it takes
// must be in stock if it is an intermediate. The production ends with its last pending item.
export function concludeItem(input: {
  productionId: string;
  itemId: string;
  belowTarget: boolean;
  hasLeftoversInCost: boolean;
  createdById: string;
}): Promise<ProductionResult> {
  const { productionId, belowTarget, hasLeftoversInCost, createdById } = input;
  const today = localToday();

  return inHeldProduction(productionId, async (tx) => {
    const production = await holdProduction(tx, productionId);
    const item = production.items.find((found) => found.id === input.itemId.toLowerCase());

    if (item === undefined) throw new ProductionAborted(itemNotFound);
    if (item.status !== ProductionItemStatus.PENDING) throw new ProductionAborted(notPending);
    if (awaitsWeighing(item)) throw new ProductionAborted(awaitsNewWeighing);

    const waiting = pendingDependencies(production, [item]);

    if (waiting !== null) throw new ProductionAborted(waiting);
    if (item.batches.length === 0) throw new ProductionAborted(noBatch);
    // A lot never comes in already expired; the operator fixes the batch's expiry first.
    if (item.batches.some(({ expiresAt }) => (toOptionalDateString(expiresAt) ?? today) < today)) {
      throw new ProductionAborted(batchExpired);
    }

    const below = producedOf(item.batches).lt(item.expectedQuantity);

    if (below && !belowTarget) throw new ProductionAborted(belowItsTarget);

    const balances = await holdStockBalances(tx, balancesMovedBy([item]));
    const missing = below ? takersShortage(production, item, balances) : null;

    if (missing !== null) throw new ProductionAborted(missing);

    const short = intermediateShortage([asConcluded(production.items, item)], balances);

    if (short !== null) throw new ProductionAborted(short);

    await concludeHeld(tx, production, item, { hasLeftoversInCost, createdById, today, costOutOfRange: "refuse" });
    await closeIfResolved(tx, productionId);
  });
}

// An item is concluded after the items of those concluding that make what it takes, so what they made
// is in stock when it takes it.
function inDependencyOrder(items: ProductionItemRecord[]) {
  const left = [...items];
  const ordered: ProductionItemRecord[] = [];
  const takes = (item: ProductionItemRecord, other: ProductionItemRecord) =>
    item.inputs.some(({ product }) => product.sku === other.product.sku);

  while (left.length > 0) {
    const next = left.find((item) => !left.some((other) => other !== item && takes(item, other))) ?? left[0]!;

    ordered.push(next);
    left.splice(left.indexOf(next), 1);
  }

  return ordered;
}

// Giving up a production keeps what was already made of it: each pending item with batches is
// concluded with them, never refused, since it happened at the bench (no target, no shortage, an
// intermediate's balance may go negative, an expiry already past is taken, a cost the stock cannot hold
// is the average cost), its leftovers in the cost.
// The items not made let go of their pre-weighings: what was weighed waits for another production.
export function cancelProduction(input: { id: string; createdById: string }): Promise<ProductionResult> {
  const { id, createdById } = input;
  const today = localToday();

  return inHeldProduction(id, async (tx) => {
    const production = await holdProduction(tx, id);
    const made = inDependencyOrder(
      production.items.filter((item) => item.status === ProductionItemStatus.PENDING && item.batches.length > 0),
    );

    // Every balance the conclusions move is held before any moves, in the order a conclusion holds them.
    await holdStockBalances(tx, balancesMovedBy(made));

    for (const item of made) {
      await concludeHeld(tx, production, item, {
        hasLeftoversInCost: true,
        createdById,
        today,
        costOutOfRange: "averageCost",
      });
    }

    await markProductionCanceled(tx, id);
    await releasePreWeighings(tx, id);
  });
}
