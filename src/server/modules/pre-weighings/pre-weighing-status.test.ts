import { describe, expect, it } from "vitest";
import { isStale, preWeighingStatusOf, STALE_AFTER_MS } from "./pre-weighing-status";

describe("preWeighingStatusOf", () => {
  it.each([
    [false, null, "PENDING"],
    [false, "PENDING", "IN_PRODUCTION"],
    [false, "FINISHED", "PRODUCED"],
    [false, "SUBSTITUTED", "PENDING"],
    [true, null, "DAMAGED"],
    [true, "PENDING", "DAMAGED"],
    [true, "FINISHED", "DAMAGED"],
    [true, "SUBSTITUTED", "DAMAGED"],
  ] as const)("damaged %s with item %s is %s", (damaged, itemStatus, expected) => {
    expect(preWeighingStatusOf({ damaged, itemStatus })).toBe(expected);
  });
});

describe("preWeighingStatusOf for an extra weighing", () => {
  it.each([
    [false, "PENDING", "IN_PRODUCTION"],
    [false, "FINISHED", "PRODUCED"],
    [false, "SUBSTITUTED", "PENDING"],
    [true, "PENDING", "DAMAGED"],
  ] as const)("damaged %s with the item %s is %s", (damaged, extraItemStatus, expected) => {
    expect(preWeighingStatusOf({ damaged, itemStatus: null, extraItemStatus })).toBe(expected);
  });
});

describe("isStale", () => {
  const now = new Date("2026-11-22T12:00:00.000Z");

  it("is not stale at exactly 48 hours", () => {
    expect(isStale(new Date(now.getTime() - STALE_AFTER_MS), now)).toBe(false);
  });

  it("is stale 1 ms past 48 hours", () => {
    expect(isStale(new Date(now.getTime() - STALE_AFTER_MS - 1), now)).toBe(true);
  });

  it("is not stale when created now", () => {
    expect(isStale(now, now)).toBe(false);
  });
});
