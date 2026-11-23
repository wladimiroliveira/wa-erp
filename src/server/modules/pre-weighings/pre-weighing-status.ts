import type { z } from "zod";
import type { preWeighingStatusSchema } from "./pre-weighings.schemas";

export type PreWeighingStatus = z.output<typeof preWeighingStatusSchema>;

type ItemStatus = "PENDING" | "FINISHED" | "SUBSTITUTED";

// Derived, never stored. A damage wins over everything; an item that was substituted no longer
// uses the pre-weighing, so it counts as pending again.
export function preWeighingStatusOf(input: { damaged: boolean; itemStatus: ItemStatus | null }): PreWeighingStatus {
  if (input.damaged) return "DAMAGED";
  if (input.itemStatus === "FINISHED") return "PRODUCED";
  if (input.itemStatus === "PENDING") return "IN_PRODUCTION";

  return "PENDING";
}

// Pre-weighings never expire; one pending for longer than this is only flagged.
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export const isStale = (createdAt: Date, now: Date) => now.getTime() - createdAt.getTime() > STALE_AFTER_MS;
