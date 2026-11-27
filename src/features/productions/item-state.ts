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

// Batches and extra weighings are what the operator really made: the server keeps them from a damage
// or a substitution, which would throw them away.
const hasBeenMade = (item: Item): boolean => item.batches.length > 0 || item.extraWeighings > 0;

/** Items whose stage can go wrong now: the ones the form can finish, of which nothing was made yet. */
export const canDamage = (item: Item, items: Item[]): boolean =>
  !hasBeenMade(item) && finishableItems(items).includes(item);

/** Whether another item of the production takes this one: an intermediate, not the main product. */
export const isTakenByAnother = (item: Item, items: Item[]): boolean =>
  items.some(({ id, dependsOn }) => id !== item.id && dependsOn.includes(item.id));

/** Pending items another item takes, of which nothing was made yet: the only ones stock of the same product can stand in for. */
export const canSubstitute = (item: Item, items: Item[]): boolean =>
  item.status === "PENDING" && !hasBeenMade(item) && isTakenByAnother(item, items);
