import type { MeasurementUnit } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { formatDecimal, formatMoney } from "@/lib/decimal";
import { unitLabel } from "@/lib/units";
import { costPerReadableUnit, readableQuantity } from "@/shared/units";

/** What a cell shows when there is nothing to show. */
export const NOTHING = "—";

export function quantityOf(quantity: string | null, unit: MeasurementUnit): string {
  return quantity === null ? NOTHING : `${formatDecimal(quantity)} ${unitLabel(unit)}`;
}

/** How a packaging reads: its content in the unit that shows it best, "380 g" or "1 kg". */
export function packagingOf(content: string, unit: MeasurementUnit): string {
  const readable = readableQuantity(content, unit);

  return quantityOf(readable.quantity, readable.unit);
}

/** The number of a quantity alone, for a table that shows its unit in a column of its own. */
export function amountOf(quantity: string | null): string {
  return quantity === null ? NOTHING : formatDecimal(quantity);
}

/** A cost per unit as prices are compared: per kilogram or litre, the unit written after it. */
export function unitCostOf(cost: string | null, unit: MeasurementUnit): string {
  if (cost === null) return NOTHING;

  const readable = costPerReadableUnit(cost, unit);

  return `${formatMoney(readable.cost)}/${unitLabel(readable.unit)}`;
}

export function moneyOf(amount: string | null): string {
  return amount === null ? NOTHING : formatMoney(amount);
}

export function dayOf(day: string | null, none = NOTHING): string {
  return day === null ? none : formatDate(day);
}
