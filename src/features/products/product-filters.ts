import { PRODUCT_KINDS } from "@/features/products/product-kinds";
import type { ProductStatus } from "@/lib/api";
import type { ProductFilters } from "@/server/modules/products/products.schemas";
import { UNITS } from "@/lib/units";
import { readList, readText, withValues } from "@/lib/url-filters";

/** What the status filter offers. `ALL` exists only in the address: the API reads a missing status as every product. */
export const STATUS_CHOICES = ["ACTIVE", "INACTIVE", "ALL"] as const satisfies readonly (ProductStatus | "ALL")[];

export type StatusChoice = (typeof STATUS_CHOICES)[number];

const STATUS_LABELS: Record<StatusChoice, string> = {
  ACTIVE: "Ativos",
  INACTIVE: "Inativos",
  ALL: "Todos",
};

export function statusLabel(choice: StatusChoice): string {
  return STATUS_LABELS[choice];
}

// The list opens on the products still in use. The default is the missing parameter, so the plain
// address stays the plain list.
const DEFAULT_STATUS: StatusChoice = "ACTIVE";

const FILTER_KEYS = ["q", "kind", "unit", "status"] as const;

export function readStatusChoice(params: URLSearchParams): StatusChoice {
  return readList(params, "status", STATUS_CHOICES)[0] ?? DEFAULT_STATUS;
}

/** The filters the address asks for. A value it does not know is ignored rather than sent to the API. */
export function readProductFilters(params: URLSearchParams): ProductFilters {
  const q = readText(params, "q");
  const kind = readList(params, "kind", PRODUCT_KINDS);
  const unit = readList(params, "unit", UNITS);
  const status = readStatusChoice(params);

  return {
    ...(q === undefined ? {} : { q }),
    ...(kind.length === 0 ? {} : { kind }),
    ...(unit.length === 0 ? {} : { unit }),
    ...(status === "ALL" ? {} : { status }),
  };
}

/** Whether the address narrows the list beyond what it opens with. */
export function hasProductFilters(params: URLSearchParams): boolean {
  return FILTER_KEYS.some((key) => params.has(key));
}

export function withStatusChoice(params: URLSearchParams, choice: StatusChoice): URLSearchParams {
  return withValues(params, "status", choice === DEFAULT_STATUS ? [] : [choice]);
}

export function withoutProductFilters(params: URLSearchParams): URLSearchParams {
  return FILTER_KEYS.reduce((next, key) => withValues(next, key, []), params);
}
