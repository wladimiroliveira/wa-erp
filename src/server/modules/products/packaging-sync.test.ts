import { describe, expect, it } from "vitest";
import { planPackagingSync } from "./packaging-sync";

const BAG = "018f0000-0000-7000-8000-000000000101";
const SACK = "018f0000-0000-7000-8000-000000000102";
const BOX = "018f0000-0000-7000-8000-000000000103";

const stored = (id: string, content: string, gtin: string | null = null) => ({ id, content, gtin });
const write = (id: string | undefined, content: string, gtin: string | null = null) => ({
  ...(id === undefined ? {} : { id }),
  content,
  gtin,
  isActive: true,
});

describe("planPackagingSync", () => {
  it("removes the stored packagings left out of the list", () => {
    const plan = planPackagingSync([stored(BAG, "1"), stored(SACK, "5")], [write(BAG, "1")]);

    expect(plan.deletes).toEqual([SACK]);
  });

  it("changes a packaging only after the one holding its new content has moved away", () => {
    const plan = planPackagingSync([stored(BAG, "1"), stored(SACK, "5")], [write(BAG, "5"), write(SACK, "10")]);

    expect(plan.updates.map(({ id }) => id)).toEqual([SACK, BAG]);
  });

  it("reads contents written differently as the same content", () => {
    const plan = planPackagingSync(
      [stored(BAG, "1.000000"), stored(SACK, "5")],
      [write(BAG, "5"), write(SACK, "10"), write(undefined, "1")],
    );

    expect(plan.updates.map(({ id }) => id)).toEqual([SACK, BAG]);
  });

  it("frees every GTIN that changes before any packaging takes a new one", () => {
    const plan = planPackagingSync(
      [stored(BAG, "1", null), stored(SACK, "5", "7891000100103"), stored(BOX, "10", "78910003")],
      [write(BAG, "1", "7891000100103"), write(SACK, "5", null), write(BOX, "10", "78910003")],
    );

    expect(plan.clearGtins).toEqual([SACK]);
  });

  it("registers the new packagings after the stored ones have moved", () => {
    const plan = planPackagingSync([stored(BAG, "1")], [write(BAG, "2"), write(undefined, "1")]);

    expect(plan.updates).toEqual([write(BAG, "2")]);
    expect(plan.creates).toEqual([write(undefined, "1")]);
  });

  it("still lists both sides of a swap, which no order can save", () => {
    const plan = planPackagingSync([stored(BAG, "1"), stored(SACK, "5")], [write(BAG, "5"), write(SACK, "1")]);

    expect(plan.updates.map(({ id }) => id).sort()).toEqual([BAG, SACK].sort());
  });
});
