import type { PreWeighingStatus } from "@/lib/api";

// "all" is how the address asks for every status; leaving the parameter out means the same.
export type PreWeighingFilter = PreWeighingStatus | "all";

export const PRE_WEIGHING_STATUS_LABELS: Record<PreWeighingStatus, string> = {
  PENDING: "Pendente",
  IN_PRODUCTION: "Em produção",
  PRODUCED: "Produzida",
  DAMAGED: "Avariada",
};

export const PRE_WEIGHING_FILTER_LABELS: Record<PreWeighingFilter, string> = {
  all: "Todas",
  ...PRE_WEIGHING_STATUS_LABELS,
};

/** The filter the address asks for, or "all" for anything it does not know. */
export function readPreWeighingFilter(raw: unknown): PreWeighingFilter {
  return (Object.keys(PRE_WEIGHING_FILTER_LABELS) as PreWeighingFilter[]).find((filter) => filter === raw) ?? "all";
}

/** The status the server lists by, none meaning every one. */
export function statusOfPreWeighingFilter(filter: PreWeighingFilter): PreWeighingStatus | undefined {
  return filter === "all" ? undefined : filter;
}
