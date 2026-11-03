import type { MeasurementUnit } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { formatDecimal, formatMoney } from "@/lib/decimal";
import { unitLabel } from "@/lib/units";

/** What a cell shows when there is nothing to show. */
export const NOTHING = "—";

export function quantityOf(quantity: string | null, unit: MeasurementUnit): string {
  return quantity === null ? NOTHING : `${formatDecimal(quantity)} ${unitLabel(unit)}`;
}

export function moneyOf(amount: string | null): string {
  return amount === null ? NOTHING : formatMoney(amount);
}

export function dayOf(day: string | null, none = NOTHING): string {
  return day === null ? none : formatDate(day);
}
