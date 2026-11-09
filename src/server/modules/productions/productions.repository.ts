import { Prisma, ProductionStatus, StockMovementType } from "@prisma/client";
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
  hasLeftoversInCost: true,
  items: {
    select: {
      id: true,
      preWeighingId: true,
      expectedQuantity: true,
      producedQuantity: true,
      unitCost: true,
      product: { select: productSelect },
      inputs: {
        select: {
          id: true,
          quantity: true,
          unitCost: true,
          product: { select: { ...productSelect, isStorableOnceOpened: true } },
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

export function insertProduction(input: { createdById: string; items: PlannedProductionItem[] }) {
  return prisma.production.create({
    data: {
      createdById: input.createdById,
      items: { create: input.items.map(({ inputs, ...item }) => ({ ...item, inputs: { create: inputs } })) },
    },
    select: productionSelect,
  });
}

export function findProductionById(id: string) {
  return prisma.production.findUnique({ where: { id }, select: productionSelect });
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
// simultaneous requests from finishing the same production twice, or one from finishing what
// another is canceling.
async function leaveInProgress(
  tx: Prisma.TransactionClient,
  id: string,
  data: { status: ProductionStatus; finishedAt?: Date; canceledAt?: Date; hasLeftoversInCost?: boolean },
) {
  const { count } = await tx.production.updateMany({ where: { id, status: ProductionStatus.IN_PROGRESS }, data });

  return count === 1;
}

export const markProductionFinished = (tx: Prisma.TransactionClient, id: string, hasLeftoversInCost: boolean) =>
  leaveInProgress(tx, id, { status: ProductionStatus.FINISHED, finishedAt: new Date(), hasLeftoversInCost });

export const markProductionCanceled = (tx: Prisma.TransactionClient, id: string) =>
  leaveInProgress(tx, id, { status: ProductionStatus.CANCELED, canceledAt: new Date() });

// A pre-weighing guides a single item, so the items of a production that will not happen let go
// of theirs: what was weighed is still on the bench, waiting for another production.
export function releasePreWeighings(tx: Prisma.TransactionClient, productionId: string) {
  return tx.productionItem.updateMany({ where: { productionId }, data: { preWeighingId: null } });
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

// What finishing a production would discard of the opened packagings, as the stock stands now. The
// items share what they open, as at the finish: each product is taken once for all of them, and
// what is left split by what each input needs. It writes nothing: by then, the lots may be others.
export async function previewProductionLeftovers(production: ProductionRecord, today: string) {
  const byProduct = new Map<
    string,
    {
      product: ProductionRecord["items"][number]["inputs"][number]["product"];
      inputs: { itemId: string; inputId: string; taken: Prisma.Decimal }[];
    }
  >();

  for (const item of production.items) {
    for (const { id: inputId, product, quantity } of item.inputs) {
      if (product.isStorableOnceOpened) continue;

      const entry = byProduct.get(product.sku) ?? { product, inputs: [] };

      entry.inputs.push({ itemId: item.id, inputId, taken: quantity });
      byProduct.set(product.sku, entry);
    }
  }

  const leftovers = new Map(production.items.map((item) => [item.id, [] as PreviewedLeftover[]]));

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

  return production.items.map((item) => ({ itemId: item.id, leftovers: leftovers.get(item.id)! }));
}

type PreviewedLeftover = {
  product: ProductionRecord["items"][number]["inputs"][number]["product"];
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
    createdById: string;
  },
) {
  const { id, productSku, quantity, unitCost, expiresAt, createdById } = item;
  const lot = await openLot(tx, { productSku, quantity, unitCost, expiresAt });

  await tx.stockMovement.create({
    data: { productSku, quantity, unitCost, createdById, lotId: lot.id, type: StockMovementType.PRODUCTION_OUTPUT },
  });
  await increaseStock(tx, { productSku, quantity, unitCost: unitCost.toString() });
  await tx.productionItem.update({ where: { id }, data: { producedQuantity: quantity, unitCost } });
}
