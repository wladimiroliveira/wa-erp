import type { Production, ProductionItem } from "@/lib/api";
import { quantityOf } from "@/features/stock/stock-format";

import { finishableItems } from "./item-state";

export type TimelineEvent = {
  /** ISO; null only for a substitution recorded before substitutedAt existed. */
  at: string | null;
  text: string;
  /** The item the event is about; null for the production's own events. */
  item: ProductionItem | null;
  /** True on the line that closes the item's story (finished or substituted): where its receipt belongs. */
  ends: boolean;
};

export type WaitingItem = { item: ProductionItem; waitsFor: string[]; notProduced: boolean };

const byDescription = (a: string, b: string): number => a.localeCompare(b, "pt-BR");

function eventsOf(production: Production): TimelineEvent[] {
  const events: TimelineEvent[] = [{ at: production.createdAt, text: "Produção iniciada", item: null, ends: false }];

  for (const item of production.items) {
    const name = item.product.description;

    if (item.finishedAt !== null) {
      events.push({
        at: item.finishedAt,
        text: `${name} finalizado · ${quantityOf(item.producedQuantity, item.product.unit)}`,
        item,
        ends: true,
      });
    }

    for (const batch of item.batches) {
      const made = `Leva de ${name} registrada · ${quantityOf(batch.quantity, item.product.unit)}`;

      events.push({
        at: batch.createdAt,
        text: batch.source === "EXISTING" ? `${made} · já existia` : made,
        item,
        ends: false,
      });
    }

    for (const damage of item.damages) {
      events.push({ at: damage.createdAt, text: `${name} avariado · ${damage.reason.name}`, item, ends: false });
    }

    if (item.status === "SUBSTITUTED") {
      events.push({ at: item.substitutedAt, text: `${name} substituído pelo estoque`, item, ends: true });
    }

    if (item.weighedAt !== null && item.preWeighingId !== null) {
      if (item.damages.length > 0) {
        events.push({ at: item.weighedAt, text: `Nova pesagem de ${name}`, item, ends: false });
      } else if (item.weighedAt > production.createdAt) {
        events.push({ at: item.weighedAt, text: `Pesagem adicional de ${name}`, item, ends: false });
      }
    }
  }

  if (production.finishedAt !== null)
    events.push({ at: production.finishedAt, text: "Produção finalizada", item: null, ends: false });
  if (production.canceledAt !== null)
    events.push({ at: production.canceledAt, text: "Produção cancelada", item: null, ends: false });

  // Array.sort is stable: events with the same time, or without one, keep the order they were built in.
  const timed = events.filter(({ at }) => at !== null).sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""));

  return [...timed, ...events.filter(({ at }) => at === null)];
}

/** Items in an order where each comes after the pending items it takes from. */
function inDependencyOrder(items: ProductionItem[]): ProductionItem[] {
  const ordered: ProductionItem[] = [];
  const seen = new Set<string>();

  function visit(item: ProductionItem): void {
    if (seen.has(item.id)) return;
    seen.add(item.id);

    for (const id of item.dependsOn) {
      const dependency = items.find((other) => other.id === id);

      if (dependency !== undefined) visit(dependency);
    }
    ordered.push(item);
  }

  items.forEach(visit);

  return ordered;
}

/** The production as a timeline: what happened, what can be worked on now, and what waits. Never stored. */
export function timelineOf(production: Production): {
  done: TimelineEvent[];
  now: ProductionItem[];
  next: WaitingItem[];
} {
  const done = eventsOf(production);

  if (production.status === "FINISHED") return { done, now: [], next: [] };

  const pending = production.items.filter(({ status }) => status === "PENDING");

  if (production.status === "CANCELED") {
    const next = inDependencyOrder(pending).map((item) => ({ item, waitsFor: [], notProduced: true }));

    return { done, now: [], next };
  }

  const ready = finishableItems(production.items);
  const awaiting = pending.filter(({ awaitsWeighing }) => awaitsWeighing);
  const now = [...ready, ...awaiting];
  const waiting = pending.filter((item) => !now.includes(item));
  const next = inDependencyOrder(waiting).map((item) => ({
    item,
    waitsFor: pending
      .filter(({ id }) => item.dependsOn.includes(id))
      .map(({ product }) => product.description)
      .sort(byDescription),
    notProduced: false,
  }));

  return { done, now, next };
}
