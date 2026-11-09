import { MeasurementUnit, Prisma, ProductionStatus } from "@prisma/client";
import { localToday } from "@/server/lib/dates";
import { toStoredDecimal } from "@/server/lib/decimal";
import { toPage } from "@/server/lib/pagination";
import { isUniqueViolation } from "@/server/lib/prisma-errors";
import { fail, succeed, type Failure, type Result } from "@/server/lib/result";
import { findPreWeighingById } from "@/server/modules/pre-weighings/pre-weighings.repository";
import { planPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";
import { holdStockBalances } from "@/server/modules/stock/stock.repository";
import {
  consumeProductionInput,
  discardLeftover,
  findProductionById,
  inProductionTransaction,
  insertProduction,
  listProductions,
  markProductionCanceled,
  markProductionFinished,
  outputProductionItem,
  previewProductionLeftovers,
  releasePreWeighings,
} from "./productions.repository";
import type { PlannedProductionItem, ProductionRecord } from "./productions.repository";
import type { ProductionItemRequest } from "./productions.schemas";
import { leftoverOf, splitLeftover } from "./production-leftovers";

type ProductionFailure = Failure<404 | 409>;
type ProductionResult = Result<PresentedProduction, 404 | 409>;

const notFound = fail(404, "Production not found.");
const notInProgress = fail(409, "Production is not in progress.");

const summaryOf = ({ sku, description, unit }: { sku: string; description: string; unit: MeasurementUnit }) => ({
  sku,
  description,
  unit,
});

/** A production as the screens and the mobile app read it: every amount as a decimal string. */
export const presentProduction = (production: ProductionRecord) => ({
  id: production.id,
  status: production.status,
  createdAt: production.createdAt.toISOString(),
  finishedAt: production.finishedAt?.toISOString() ?? null,
  canceledAt: production.canceledAt?.toISOString() ?? null,
  hasLeftoversInCost: production.hasLeftoversInCost,
  items: production.items.map((item) => ({
    id: item.id,
    product: item.product,
    preWeighingId: item.preWeighingId,
    expectedQuantity: item.expectedQuantity.toString(),
    producedQuantity: item.producedQuantity?.toString() ?? null,
    unitCost: item.unitCost?.toString() ?? null,
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
});

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

// The inputs of an item are settled when the production starts, so what the operator is guided by
// is what leaves the stock when it finishes, whatever happens to the recipe in between.
async function planItem(request: ProductionItemRequest): Promise<Result<PlannedProductionItem, 404 | 409>> {
  if ("preWeighingId" in request) {
    const preWeighing = await findPreWeighingById(request.preWeighingId);

    if (preWeighing === null) return fail(404, "Pre-weighing not found.");

    return succeed({
      productSku: preWeighing.product.sku,
      preWeighingId: preWeighing.id,
      expectedQuantity: preWeighing.quantity,
      inputs: preWeighing.items.map(({ product, weighedQuantity }) => ({
        productSku: product.sku,
        quantity: weighedQuantity,
      })),
    });
  }

  const result = await planPreWeighing(request.productSku, request.quantity);

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

export async function startProduction(input: {
  createdById: string;
  items: ProductionItemRequest[];
}): Promise<ProductionResult> {
  const items: PlannedProductionItem[] = [];

  for (const request of input.items) {
    const result = await planItem(request);

    if (!result.ok) return result;

    items.push(result.data);
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

// Finishing is where the stock moves: every input leaves the lots that expire first, at what each
// of them cost, and each product comes in as a lot costing what its inputs cost, spread over what
// was really produced.
export async function finishProduction(input: {
  id: string;
  createdById: string;
  items: { id: string; producedQuantity: string; expiresAt: string | null }[];
  hasLeftoversInCost?: boolean;
}): Promise<ProductionResult> {
  const { id, createdById, hasLeftoversInCost = true } = input;
  const production = await findProductionById(id);

  if (production === null) return notFound;
  if (production.status !== ProductionStatus.IN_PROGRESS) return notInProgress;

  const producedById = new Map(input.items.map((item) => [item.id.toLowerCase(), item]));

  if (production.items.length !== producedById.size || production.items.some((item) => !producedById.has(item.id))) {
    return fail(409, "The items do not match the items of the production.");
  }

  try {
    const today = localToday();

    await inProductionTransaction(async (tx) => {
      if (!(await markProductionFinished(tx, id, hasLeftoversInCost))) throw new ProductionAborted(notInProgress);

      await holdStockBalances(
        tx,
        production.items.flatMap((item) => [item.product.sku, ...item.inputs.map((input) => input.product.sku)]),
      );

      // Every item takes its inputs first: the items of a production are made together, so they
      // share the packagings they open, and what is left of them is only known once all have taken.
      const costs = new Map(production.items.map((item) => [item.id, new Prisma.Decimal(0)]));
      const opened = new Map<string, OpenedLot>();

      for (const item of production.items) {
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

      for (const item of production.items) {
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
          createdById,
        });
      }
    });
  } catch (error) {
    if (error instanceof ProductionAborted) return error.result;

    throw error;
  }

  return succeed(presentProduction((await findProductionById(id))!));
}

/** What finishing the production would discard of the opened packagings, priced at each lot's cost. */
export async function previewLeftovers(id: string) {
  const production = await findProductionById(id);

  if (production === null) return notFound;
  if (production.status !== ProductionStatus.IN_PROGRESS) return notInProgress;

  const items = (await previewProductionLeftovers(production, localToday())).map(({ itemId, leftovers }) => ({
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

// A production moves the stock only when it finishes, so giving one up has nothing to put back.
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

export async function getProduction(id: string): Promise<Result<PresentedProduction, 404>> {
  const production = await findProductionById(id);

  if (production === null) return notFound;

  return succeed(presentProduction(production));
}

export async function listProductionsPage(query: { status?: ProductionStatus; limit: number; cursor?: string }) {
  const { items, nextCursor } = toPage(await listProductions(query), query);

  return { items: items.map(presentProduction), nextCursor };
}
