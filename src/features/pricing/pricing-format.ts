import { moneyOf } from "@/features/stock/stock-format";

/**
 * A cost as money. Costs carry six places so that cheap ingredients keep their value; the zeros
 * past the cent say nothing and are dropped, so 1.500000 reads R$ 1,50 and 0.012345 stays exact.
 */
export function costOf(amount: string | null): string {
  return moneyOf(amount === null ? null : amount.replace(/(\.\d{2}\d*?)0+$/, "$1"));
}
