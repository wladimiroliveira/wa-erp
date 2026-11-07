import { PRODUCTION_STATUSES, type ProductionStatus } from "@/shared/enums";

// The list opens on what is still to be done; "all" is how the address asks for every status,
// since leaving the parameter out already means the default.
export type StatusFilter = ProductionStatus | "all";

export const DEFAULT_STATUS_FILTER: StatusFilter = "IN_PROGRESS";

const FILTERS: readonly StatusFilter[] = [...PRODUCTION_STATUSES, "all"];

/** The filter the address asks for, or the default for anything it does not know. */
export function readStatusFilter(raw: unknown): StatusFilter {
  return FILTERS.find((filter) => filter === raw) ?? DEFAULT_STATUS_FILTER;
}

/** The status the server lists by, none meaning every one. */
export function statusOfFilter(filter: StatusFilter): ProductionStatus | undefined {
  return filter === "all" ? undefined : filter;
}

export const STATUS_LABELS: Record<ProductionStatus, string> = {
  IN_PROGRESS: "Em andamento",
  FINISHED: "Finalizada",
  CANCELED: "Cancelada",
};

export const FILTER_LABELS: Record<StatusFilter, string> = {
  IN_PROGRESS: "Em andamento",
  FINISHED: "Finalizadas",
  CANCELED: "Canceladas",
  all: "Todas",
};
