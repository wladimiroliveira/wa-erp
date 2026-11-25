import type { Production } from "@/lib/api";

type Item = Production["items"][number];

const pendingDependenciesOf = (item: Item, items: Item[]): Item[] =>
  item.dependsOn.flatMap((id) => items.filter((other) => other.id === id && other.status === "PENDING"));

/** The items the form can finish now: pending, not awaiting a weighing, taking nothing that is still pending. */
export function finishableItems(items: Item[]): Item[] {
  return items.filter(
    (item) => item.status === "PENDING" && !item.awaitsWeighing && pendingDependenciesOf(item, items).length === 0,
  );
}

/** Items whose stage can go wrong now: the same ones the form can finish. */
export const canDamage = (item: Item, items: Item[]): boolean => finishableItems(items).includes(item);

/** Pending items another item takes: the only ones stock of the same product can stand in for. */
export const canSubstitute = (item: Item, items: Item[]): boolean =>
  item.status === "PENDING" && items.some(({ id, dependsOn }) => id !== item.id && dependsOn.includes(item.id));
