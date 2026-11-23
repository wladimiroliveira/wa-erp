import type { Production } from "@/lib/api";

type Item = Production["items"][number];

const pendingDependenciesOf = (item: Item, items: Item[]): Item[] =>
  item.dependsOn.flatMap((id) => items.filter((other) => other.id === id && other.status === "PENDING"));

/**
 * What an item is waiting for to be finished, or that it is done, for the badge beside it. Once the
 * production is canceled, nothing is waited for: an item still pending was simply not produced.
 */
export function itemStateLabel(item: Item, items: Item[], productionStatus: Production["status"]): string {
  if (item.status === "FINISHED") return "Finalizado";
  if (item.status === "SUBSTITUTED") return "Substituído pelo estoque";
  if (productionStatus === "CANCELED") return "Não produzido";
  if (item.awaitsWeighing) return "Avariado — aguardando nova pesagem";

  const waitsFor = pendingDependenciesOf(item, items);
  // Alphabetical: the order the items take each other in is not one the operator knows.
  const names = waitsFor.map(({ product }) => product.description).sort((a, b) => a.localeCompare(b, "pt-BR"));

  return waitsFor.length > 0 ? `Aguardando ${names.join(", ")}` : "A produzir";
}

/** The items the form can finish now: pending, not awaiting a weighing, taking nothing that is still pending. */
export function finishableItems(items: Item[]): Item[] {
  return items.filter(
    (item) => item.status === "PENDING" && !item.awaitsWeighing && pendingDependenciesOf(item, items).length === 0,
  );
}

/**
 * The items as a tree: an item sits under the items that take it, roots (taken by none) first.
 * An item taken by several shows once, under the first that reaches it.
 */
export function itemsAsTree(items: Item[]): { item: Item; depth: number }[] {
  const taken = new Set(items.flatMap(({ dependsOn }) => dependsOn));
  const roots = items.filter(({ id }) => !taken.has(id));
  const seen = new Set<string>();
  const ordered: { item: Item; depth: number }[] = [];

  function visit(item: Item, depth: number): void {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    ordered.push({ item, depth });

    for (const id of item.dependsOn) {
      const child = items.find((other) => other.id === id);

      if (child !== undefined) visit(child, depth + 1);
    }
  }

  for (const root of roots) visit(root, 0);
  // Anything left is in a cycle the server never builds; still shown, never dropped.
  for (const item of items) visit(item, 0);

  return ordered;
}

/** Items whose stage can go wrong now: the same ones the form can finish. */
export const canDamage = (item: Item, items: Item[]): boolean => finishableItems(items).includes(item);

/** Pending items another item takes: the only ones stock of the same product can stand in for. */
export const canSubstitute = (item: Item, items: Item[]): boolean =>
  item.status === "PENDING" && items.some(({ id, dependsOn }) => id !== item.id && dependsOn.includes(item.id));
