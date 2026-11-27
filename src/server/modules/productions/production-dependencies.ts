import type { ProductionItemStatus } from "@/shared/enums";

export type DependencyItem = {
  id: string;
  productSku: string;
  status: ProductionItemStatus;
  inputSkus: string[];
};

/** For each item, the ids of the other items whose product is one of its inputs (SKUs compared lower-case). */
export function dependenciesOf(items: DependencyItem[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const item of items) {
    const inputs = new Set(item.inputSkus.map((sku) => sku.toLowerCase()));
    result.set(
      item.id,
      items
        .filter((other) => other.id !== item.id && inputs.has(other.productSku.toLowerCase()))
        .map((other) => other.id),
    );
  }
  return result;
}

/** The dependencies of an item that are still pending. */
export function waitingFor(itemId: string, items: DependencyItem[]): string[] {
  const status = new Map(items.map((item) => [item.id, item.status]));
  return (dependenciesOf(items).get(itemId) ?? []).filter((id) => status.get(id) === "PENDING");
}
