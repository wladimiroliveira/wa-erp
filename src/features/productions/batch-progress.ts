import { quantityOf } from "@/features/stock/stock-format";
import type { ProductionItem } from "@/lib/api";
import { fromScaled, toScaled } from "@/shared/fixed-point";
import { normalizeDecimal } from "@/shared/units";

// Quantities travel with up to 6 places: summed at that scale, nothing is lost.
const PLACES = 6;

export type BatchProgress = {
  /** What the item's batches add up to. */
  produced: string;
  /** What is still short of the expected; zero once it is reached. */
  missing: string;
  reached: boolean;
};

const decimalOf = (scaled: bigint): string => normalizeDecimal(fromScaled(scaled, PLACES));

/** How far an item's batches have gone towards what it should yield. */
export function progressOf(item: ProductionItem): BatchProgress {
  const produced = item.batches.reduce((sum, { quantity }) => sum + toScaled(quantity, PLACES), 0n);
  const expected = toScaled(item.expectedQuantity, PLACES);
  const reached = produced >= expected;

  return { produced: decimalOf(produced), missing: decimalOf(reached ? 0n : expected - produced), reached };
}

/** The progress as the card reads it: "35 un de 50 un · faltam 15 un". */
export function progressTextOf(item: ProductionItem): string {
  const { produced, missing, reached } = progressOf(item);
  const q = (quantity: string) => quantityOf(quantity, item.product.unit);
  const of = `${q(produced)} de ${q(item.expectedQuantity)}`;

  return reached ? `${of} · meta atingida` : `${of} · faltam ${q(missing)}`;
}
