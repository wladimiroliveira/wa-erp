import { Prisma, ProductionItemStatus, ProductionStatus, StockMovementType } from "@prisma/client";
import { pageArgs } from "@/server/lib/pagination";
import { prisma } from "@/server/lib/prisma";
import {
  increaseStock,
  openLot,
  suggestLots,
  takeFromHeldLot,
  takeFromLots,
} from "@/server/modules/stock/stock.repository";
import { leftoverOf, splitLeftover } from "./production-leftovers";

const productSelect = { sku: true, description: true, unit: true } satisfies Prisma.ProductSelect;

const productionSelect = {
  id: true,
  status: true,
  createdAt: true,
  finishedAt: true,
  canceledAt: true,
  items: {
    select: {
      id: true,
      status: true,
      finishedAt: true,
      hasLeftoversInCost: true,
      preWeighingId: true,
      expectedQuantity: true,
      producedQuantity: true,
      unitCost: true,
      product: { select: productSelect },
      // A damage that names a pre-weighing took it from the item, which waits for a new one.
      damages: {
        select: {
          id: true,
          preWeighingId: true,
          note: true,
          createdAt: true,
          reason: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
      inputs: {
        select: {
          id: true,
          quantity: true,
          unitCost: true,
          product: { select: { ...productSelect, isStorableOnceOpened: true, kind: true } },
          // What was discarded of the opened packagings when the production finished.
          leftovers: { select: { lotId: true, quantity: true, unitCost: true }, orderBy: { createdAt: "asc" } },
        },
        orderBy: { product: { description: "asc" } },
      },
    },
    orderBy: [{ product: { description: "asc" } }, { id: "asc" }],
  },
} satisfies Prisma.ProductionSelect;

export type ProductionRecord = Prisma.ProductionGetPayload<{ select: typeof productionSelect }>;

export type PlannedProductionItem = {
  productSku: string;
  preWeighingId: string | null;
  expectedQuantity: Prisma.Decimal;
  inputs: { productSku: string; quantity: Prisma.Decimal }[];
};

const itemData = ({ inputs, ...item }: PlannedProductionItem) => ({ ...item, inputs: { create: inputs } });

export function insertProduction(input: { createdById: string; items: PlannedProductionItem[] }) {
  return prisma.production.create({
    data: { createdById: input.createdById, items: { create: input.items.map(itemData) } },
    select: productionSelect,
  });
}

// Items that join a production already started, such as the stages of a new weighing.
export async function addProductionItems(
  tx: Prisma.TransactionClient,
  productionId: string,
  items: PlannedProductionItem[],
) {
  for (const item of items) await tx.productionItem.create({ data: { ...itemData(item), productionId } });
}

// A pending item takes a new pre-weighing to guide it: its expected quantity and its inputs become
// that pre-weighing's. Nothing of a pending item left the stock, so its old inputs simply go.
export async function reguideProductionItem(
  tx: Prisma.TransactionClient,
  itemId: string,
  { preWeighingId, expectedQuantity, inputs }: PlannedProductionItem,
) {
  await tx.productionItemInput.deleteMany({ where: { productionItemId: itemId } });
  await tx.productionItem.update({
    where: { id: itemId },
    data: { preWeighingId, expectedQuantity, inputs: { create: inputs } },
  });
}

export function findProductionById(id: string, client: Prisma.TransactionClient = prisma) {
  return client.production.findUnique({ where: { id }, select: productionSelect });
}

export function listProductions(query: { status?: ProductionStatus; limit: number; cursor?: string }) {
  const { status, ...page } = query;

  return prisma.production.findMany({ where: { status }, select: productionSelect, ...pageArgs(page) });
}

// Whatever a production moves in the stock happens in one transaction: it finishes whole or not
// at all, and so does whatever else changes along with its status.
export function inProductionTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(work);
}

// False when the production is no longer in progress. The conditional update is what keeps two
// simultaneous requests from canceling the same production twice, or one from canceling what
// another is finishing.
async function leaveInProgress(
  tx: Prisma.TransactionClient,
  id: string,
  data: { status: ProductionStatus; finishedAt?: Date; canceledAt?: Date },
) {
  const { count } = await tx.production.updateMany({ where: { id, status: ProductionStatus.IN_PROGRESS }, data });

  return count === 1;
}

// Holds the production row until the transaction ends, and answers whether it is in progress. What
// changes an item of a production in progress waits for this lock, so it cannot slip in between a
// finish or a cancel and its own write.
export async function lockProductionInProgress(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM productions WHERE id = ${id}::uuid AND status = 'IN_PROGRESS' FOR UPDATE
  `;

  return rows.length === 1;
}

// Lowers what an item is expected to yield, and sets each of its inputs to the quantity that
// yield takes.
export async function rescaleProductionItem(
  tx: Prisma.TransactionClient,
  item: { id: string; expectedQuantity: Prisma.Decimal; inputs: { id: string; quantity: Prisma.Decimal }[] },
) {
  await tx.productionItem.update({ where: { id: item.id }, data: { expectedQuantity: item.expectedQuantity } });

  for (const { id, quantity } of item.inputs) {
    await tx.productionItemInput.update({ where: { id }, data: { quantity } });
  }
}

export const markProductionCanceled = (tx: Prisma.TransactionClient, id: string) =>
  leaveInProgress(tx, id, { status: ProductionStatus.CANCELED, canceledAt: new Date() });

// A production ends by itself once no item is left to make. Run under the lock of the production,
// after the items it finishes are written, so it sees them.
export async function closeIfResolved(tx: Prisma.TransactionClient, productionId: string) {
  const { count } = await tx.production.updateMany({
    where: {
      id: productionId,
      status: ProductionStatus.IN_PROGRESS,
      items: { none: { status: ProductionItemStatus.PENDING } },
    },
    data: { status: ProductionStatus.FINISHED, finishedAt: new Date() },
  });

  return count === 1;
}

// An item taken from stock instead of made: it is resolved, and the pre-weighing that was to guide it
// is free again.
export function markItemSubstituted(tx: Prisma.TransactionClient, itemId: string) {
  return tx.productionItem.update({
    where: { id: itemId },
    data: { status: ProductionItemStatus.SUBSTITUTED, preWeighingId: null },
  });
}

// A pre-weighing guides a single item, so the items of a production that will not happen let go
// of theirs: what was weighed is still on the bench, waiting for another production. Only the items
// still pending do: a finished one made its lot and keeps its pre-weighing, which stays produced.
export function releasePreWeighings(tx: Prisma.TransactionClient, productionId: string) {
  return tx.productionItem.updateMany({
    where: { productionId, status: ProductionItemStatus.PENDING },
    data: { preWeighingId: null },
  });
}

// Takes an input from the stock, lot by lot, and answers what all of it cost and the takes, so the
// finish can work out what is left of the packagings opened. Each lot taken from is a movement of
// its own, at the cost of that lot; the input keeps what a unit of it came to.
export async function consumeProductionInput(
  tx: Prisma.TransactionClient,
  input: { id: string; productSku: string; quantity: Prisma.Decimal; createdById: string; today: string },
) {
  const { id, productSku, quantity, createdById, today } = input;
  const takes = await takeFromLots(tx, { productSku, quantity, today });

  await tx.stockMovement.createMany({
    data: takes.map(({ lotId, quantity: taken, unitCost }) => ({
      lotId,
      quantity: taken,
      unitCost,
      productSku,
      createdById,
      type: StockMovementType.PRODUCTION_CONSUMPTION,
    })),
  });

  const cost = Prisma.Decimal.sum(0, ...takes.map((take) => take.quantity.mul(take.unitCost)));

  await tx.productionItemInput.update({ where: { id }, data: { unitCost: cost.div(quantity).toDecimalPlaces(6) } });

  return { cost, takes };
}

// Records that an item went wrong. A guided item lets go of its pre-weighing, which the damage keeps
// as the one it took away; its inputs and expected quantity stay until a new weighing replaces them.
export async function insertItemDamage(
  tx: Prisma.TransactionClient,
  damage: { itemId: string; preWeighingId: string | null; reasonId: string; note: string | null; createdById: string },
) {
  const { itemId, preWeighingId, reasonId, note, createdById } = damage;
  const created = await tx.productionItemDamage.create({
    data: { productionItemId: itemId, preWeighingId, reasonId, note, createdById },
    select: { id: true },
  });

  if (preWeighingId !== null) {
    await tx.productionItem.update({ where: { id: itemId }, data: { preWeighingId: null } });
  }

  return created;
}

// Takes what an input of a damaged item would have taken, lot by lot, and writes it off as a loss
// under the damage. What no lot held leaves the balance as a loss movement alone: a recorded loss
// names its lot.
export async function writeOffForDamage(
  tx: Prisma.TransactionClient,
  input: {
    productSku: string;
    quantity: Prisma.Decimal;
    damageId: string;
    reasonId: string;
    note: string | null;
    createdById: string;
    today: string;
  },
) {
  const { productSku, quantity, damageId, reasonId, note, createdById, today } = input;

  for (const take of await takeFromLots(tx, { productSku, quantity, today })) {
    const movement = await tx.stockMovement.create({
      data: {
        productSku,
        lotId: take.lotId,
        quantity: take.quantity,
        unitCost: take.unitCost,
        createdById,
        type: StockMovementType.LOSS,
      },
    });

    if (take.lotId === null) continue;

    await tx.stockLoss.create({
      data: { lotId: take.lotId, reasonId, movementId: movement.id, note, damageId, createdById },
    });
  }
}

// Writes off what an input leaves of a lot's opened packaging: lowers the lot and the balance like
// any write-off, and ties the movement to the input. The lot is already locked by the consumption.
export async function discardLeftover(
  tx: Prisma.TransactionClient,
  leftover: {
    inputId: string;
    lotId: string;
    productSku: string;
    quantity: Prisma.Decimal;
    unitCost: Prisma.Decimal;
    createdById: string;
  },
) {
  const { inputId, lotId, productSku, quantity, unitCost, createdById } = leftover;
  // What is left of a lot after a take is never more than it holds; a lot that does not is a bug,
  // and throwing undoes the whole finish.
  await takeFromHeldLot(tx, { lotId, productSku, quantity });

  const movement = await tx.stockMovement.create({
    data: { productSku, lotId, quantity, unitCost, createdById, type: StockMovementType.OPENED_LEFTOVER },
  });

  await tx.productionLeftover.create({ data: { inputId, lotId, movementId: movement.id, quantity, unitCost } });
}

type ProductionItemRecord = ProductionRecord["items"][number];

// What finishing these items together would discard of the opened packagings, as the stock stands
// now. They share what they open, as at the finish: each product is taken once for all of them, and
// what is left split by what each input needs. It writes nothing: by then, the lots may be others.
export async function previewProductionLeftovers(items: ProductionItemRecord[], today: string) {
  const byProduct = new Map<
    string,
    {
      product: ProductionItemRecord["inputs"][number]["product"];
      inputs: { itemId: string; inputId: string; taken: Prisma.Decimal }[];
    }
  >();

  for (const item of items) {
    for (const { id: inputId, product, quantity } of item.inputs) {
      if (product.isStorableOnceOpened) continue;

      const entry = byProduct.get(product.sku) ?? { product, inputs: [] };

      entry.inputs.push({ itemId: item.id, inputId, taken: quantity });
      byProduct.set(product.sku, entry);
    }
  }

  const leftovers = new Map(items.map((item) => [item.id, [] as PreviewedLeftover[]]));

  for (const { product, inputs } of byProduct.values()) {
    const needed = Prisma.Decimal.sum(0, ...inputs.map(({ taken }) => taken));
    const { takes } = await suggestLots({ productSku: product.sku, quantity: needed, today });

    for (const { lot, quantity: taken } of takes) {
      if (lot.packageContent === null) continue;

      for (const share of splitLeftover(leftoverOf(lot.quantity, taken, lot.packageContent), inputs)) {
        const { itemId } = inputs.find(({ inputId }) => inputId === share.inputId)!;

        leftovers.get(itemId)!.push({ product, lotId: lot.id, quantity: share.quantity, unitCost: lot.unitCost });
      }
    }
  }

  return items.map((item) => ({ itemId: item.id, leftovers: leftovers.get(item.id)! }));
}

type PreviewedLeftover = {
  product: ProductionItemRecord["inputs"][number]["product"];
  lotId: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
};

// What was produced comes in as a lot of its own, costing what its inputs cost.
export async function outputProductionItem(
  tx: Prisma.TransactionClient,
  item: {
    id: string;
    productSku: string;
    quantity: string;
    unitCost: Prisma.Decimal;
    expiresAt: string | null;
    hasLeftoversInCost: boolean;
    createdById: string;
  },
) {
  const { id, productSku, quantity, unitCost, expiresAt, hasLeftoversInCost, createdById } = item;
  const lot = await openLot(tx, { productSku, quantity, unitCost, expiresAt });

  await tx.stockMovement.create({
    data: { productSku, quantity, unitCost, createdById, lotId: lot.id, type: StockMovementType.PRODUCTION_OUTPUT },
  });
  await increaseStock(tx, { productSku, quantity, unitCost: unitCost.toString() });
  await tx.productionItem.update({
    where: { id },
    data: {
      producedQuantity: quantity,
      unitCost,
      status: ProductionItemStatus.FINISHED,
      finishedAt: new Date(),
      hasLeftoversInCost,
    },
  });
}
