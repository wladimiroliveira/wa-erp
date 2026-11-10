import { normalizeDecimal } from "@/shared/units";
import type { PackagingWrite } from "./products.repository";

type StoredPackaging = { id: string; brand: string; content: string; gtin: string | null };

export type PackagingSyncPlan = {
  deletes: string[];
  /** Stored packagings whose GTIN changes: emptied first, so that another may take it. */
  clearGtins: string[];
  /** In an order where no packaging takes a brand and content another still holds. */
  updates: (PackagingWrite & { id: string })[];
  creates: PackagingWrite[];
};

// The unique indexes are checked after each statement, so a list that ends valid can still collide
// on its way there (MOÇA 1 kg → 5 kg while MOÇA 5 kg → 10 kg). The plan orders the writes so that it does not.
// Only a cycle, such as two packagings swapping contents, is left to the index to refuse.
export function planPackagingSync(stored: StoredPackaging[], writes: PackagingWrite[]): PackagingSyncPlan {
  const kept = new Set(writes.flatMap(({ id }) => (id === undefined ? [] : [id])));
  const byId = new Map(stored.map((packaging) => [packaging.id, packaging]));
  const pending = writes.filter((write): write is PackagingWrite & { id: string } => write.id !== undefined);
  const updates: PackagingSyncPlan["updates"] = [];

  while (pending.length > 0) {
    // Whether `other` still holds, as stored, the brand and content `write` takes.
    const holds = (other: PackagingWrite & { id: string }, write: PackagingWrite) => {
      const held = byId.get(other.id)!;

      return held.brand === write.brand && normalizeDecimal(held.content) === normalizeDecimal(write.content);
    };
    const ready = pending.findIndex((write) => !pending.some((other) => other !== write && holds(other, write)));

    updates.push(...pending.splice(ready === -1 ? 0 : ready, ready === -1 ? pending.length : 1));
  }

  return {
    deletes: stored.filter(({ id }) => !kept.has(id)).map(({ id }) => id),
    clearGtins: updates
      .filter(({ id, gtin }) => byId.get(id)!.gtin !== null && byId.get(id)!.gtin !== gtin)
      .map(({ id }) => id),
    updates,
    creates: writes.filter(({ id }) => id === undefined),
  };
}
