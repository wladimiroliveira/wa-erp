import type { LotStatus, StockStatus } from "@/lib/api";

type BadgeVariant = "secondary" | "destructive" | "outline";
type Reading = { label: string; badge: BadgeVariant };

const EXPIRED: Reading = { label: "Vencido", badge: "destructive" };
const EXPIRING_SOON: Reading = { label: "Vence em breve", badge: "outline" };
const OK: Reading = { label: "OK", badge: "secondary" };

const STOCK_STATUSES: Record<StockStatus, Reading> = {
  NEGATIVE: { label: "Negativo", badge: "destructive" },
  EMPTY: { label: "Zerado", badge: "destructive" },
  EXPIRED,
  EXPIRING_SOON,
  BELOW_MINIMUM: { label: "Abaixo do mínimo", badge: "outline" },
  OK,
};

const LOT_STATUSES: Record<LotStatus, Reading> = {
  DEPLETED: { label: "Esgotado", badge: "outline" },
  EXPIRED,
  EXPIRING_SOON,
  OK,
};

export function statusReading(status: StockStatus): Reading {
  return STOCK_STATUSES[status];
}

export function lotStatusReading(status: LotStatus): Reading {
  return LOT_STATUSES[status];
}

/** Everything but a healthy balance is something the operator has to act on. */
export function needsAttention(status: StockStatus): boolean {
  return status !== "OK";
}
