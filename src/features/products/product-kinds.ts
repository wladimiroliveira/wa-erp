import type { ProductKind } from "@/lib/api";

/** Display order, and the list a form iterates over. `KindCoverage` stops it from drifting from the API. */
export const PRODUCT_KINDS = ["GOODS", "MANUFACTURED"] as const satisfies readonly ProductKind[];

type AssertNever<T extends never> = T;

/** Fails to compile if the API grows a kind this file does not know about. */
export type KindCoverage = AssertNever<Exclude<ProductKind, (typeof PRODUCT_KINDS)[number]>>;

const KIND_LABELS: Record<ProductKind, string> = {
  GOODS: "Mercadoria",
  MANUFACTURED: "Fabricado",
};

export function kindLabel(kind: ProductKind): string {
  return KIND_LABELS[kind];
}
