import type { PricingRow } from "@/lib/api";
import { foldForSearch, readText, withValues } from "@/lib/url-filters";

export interface PricingFilters {
  /** Part of the description of the product. */
  q?: string;
}

export function readPricingFilters(params: URLSearchParams): PricingFilters {
  const q = readText(params, "q");

  return q === undefined ? {} : { q };
}

export function hasPricingFilters(params: URLSearchParams): boolean {
  return params.has("q");
}

export function withoutPricingFilters(params: URLSearchParams): URLSearchParams {
  return withValues(params, "q", []);
}

/** The rows the search keeps. The list is whole on the client, so narrowing it asks the server for nothing. */
export function filterPricingRows(rows: PricingRow[], { q }: PricingFilters): PricingRow[] {
  if (q === undefined) return rows;

  const search = foldForSearch(q);

  return rows.filter(({ product }) => foldForSearch(product.description).includes(search));
}
