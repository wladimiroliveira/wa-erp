import { Prisma, ProductKind } from "@prisma/client";
import { toStoredDecimal } from "@/server/lib/decimal";
import type { ProductionBatchSource } from "@/shared/enums";

type Batch = { quantity: Prisma.Decimal; source: ProductionBatchSource };

const ZERO = new Prisma.Decimal(0);

const sumOf = (batches: Batch[], source?: ProductionBatchSource) =>
  Prisma.Decimal.sum(
    0,
    ...batches.filter((batch) => source === undefined || batch.source === source).map(({ quantity }) => quantity),
  );

/** What an item yielded: every batch it came out in, made now or found already made. */
export const producedOf = (batches: Batch[]) => sumOf(batches);

/** What an item made now, the part of what it yielded its inputs went into. */
export const madeOf = (batches: Batch[]) => sumOf(batches, "PRODUCED");

/**
 * What of each input leaves the stock when an item is concluded. The part of the target covered by
 * batches that already existed was not made now, so every input leaves scaled by what was left to
 * make of the target (never above the whole). Nothing leaves when nothing was made now: no lot made
 * would carry its cost. On the main product concluded below its target, the lines taken from stock
 * without weighing leave only for what was made of all its inputs were for, the target and what the
 * extra weighings planned: the rest stayed on the bench. A weighed line leaves as weighed. Kept to
 * the places the stock holds; an input that comes to nothing is left out.
 */
export function consumptionOf(
  item: {
    expectedQuantity: Prisma.Decimal;
    // What the item's extra weighings planned to make, beyond the target its inputs started from.
    extraPlanned: Prisma.Decimal;
    inputs: { id: string; quantity: Prisma.Decimal; weighed: boolean }[];
    batches: Batch[];
  },
  { mainBelowTarget }: { mainBelowTarget: boolean },
): { inputId: string; quantity: Prisma.Decimal }[] {
  const expected = item.expectedQuantity;
  const made = madeOf(item.batches);

  if (made.lte(0)) return [];

  const toMake = Prisma.Decimal.max(expected.sub(sumOf(item.batches, "EXISTING")), 0);
  const share = Prisma.Decimal.min(toMake.div(expected), 1);
  const madeShare = made.div(expected.add(item.extraPlanned));

  return item.inputs.flatMap(({ id, quantity, weighed }) => {
    const taken = toStoredDecimal(quantity.mul(mainBelowTarget && !weighed ? madeShare : share)) ?? ZERO;

    return taken.gt(0) ? [{ inputId: id, quantity: taken }] : [];
  });
}

/** The lots an item's batches come in as: one per expiry, what was made apart from what existed. */
export function lotsOf(
  batches: (Batch & { expiresAt: string | null })[],
): { expiresAt: string | null; produced: Prisma.Decimal; existing: Prisma.Decimal }[] {
  const lots = new Map<
    string | null,
    { expiresAt: string | null; produced: Prisma.Decimal; existing: Prisma.Decimal }
  >();

  for (const { quantity, expiresAt, source } of batches) {
    const lot = lots.get(expiresAt) ?? { expiresAt, produced: ZERO, existing: ZERO };

    if (source === "PRODUCED") lot.produced = lot.produced.add(quantity);
    else lot.existing = lot.existing.add(quantity);

    lots.set(expiresAt, lot);
  }

  return [...lots.values()];
}

type ConcludableItem = {
  id: string;
  expectedQuantity: Prisma.Decimal;
  product: { sku: string };
  batches: Batch[];
  extraWeighings: { preWeighing: { quantity: Prisma.Decimal } }[];
  inputs: { id: string; quantity: Prisma.Decimal; product: { sku: string; kind: ProductKind } }[];
};

/** Whether another item of the production takes what this one makes: this one is an intermediate. */
export const isTakenByAnother = (items: ConcludableItem[], item: ConcludableItem) =>
  items.some((other) => other.id !== item.id && other.inputs.some(({ product }) => product.sku === item.product.sku));

/**
 * The item as concluding it now would take its inputs: each at what leaves the stock, the ones that
 * come to nothing left out. Only the main product (no other item takes it) is concluded below its
 * target with less of what it took from stock unweighed: a manufactured ingredient. An item with no
 * batch yet is taken as if it will reach its target.
 */
export function asConcluded<T extends ConcludableItem>(items: T[], item: T): T {
  const batches: Batch[] =
    item.batches.length > 0 ? item.batches : [{ quantity: item.expectedQuantity, source: "PRODUCED" }];
  const mainBelowTarget = producedOf(batches).lt(item.expectedQuantity) && !isTakenByAnother(items, item);
  const consumption = consumptionOf(
    {
      expectedQuantity: item.expectedQuantity,
      extraPlanned: Prisma.Decimal.sum(0, ...item.extraWeighings.map(({ preWeighing }) => preWeighing.quantity)),
      inputs: item.inputs.map(({ id, quantity, product }) => ({
        id,
        quantity,
        weighed: product.kind !== ProductKind.MANUFACTURED,
      })),
      batches,
    },
    { mainBelowTarget },
  );
  const taken = new Map(consumption.map(({ inputId, quantity }) => [inputId, quantity]));

  return {
    ...item,
    inputs: item.inputs
      .filter(({ id }) => taken.has(id))
      .map((input) => ({ ...input, quantity: taken.get(input.id)! })),
  };
}
