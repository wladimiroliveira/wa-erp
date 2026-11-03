// In order of urgency: a product is read as the first of these that applies to it. Shared so the
// schemas and the screens name the statuses without pulling the server's arithmetic in.
export const StockStatus = {
  NEGATIVE: "NEGATIVE",
  EXPIRED: "EXPIRED",
  EMPTY: "EMPTY",
  EXPIRING_SOON: "EXPIRING_SOON",
  BELOW_MINIMUM: "BELOW_MINIMUM",
  OK: "OK",
} as const;

export const LotStatus = {
  DEPLETED: "DEPLETED",
  EXPIRED: "EXPIRED",
  EXPIRING_SOON: "EXPIRING_SOON",
  OK: "OK",
} as const;
