import { describe, expect, it } from "vitest";
import { planPackagingSync } from "./packaging-sync";

const BAG = "018f0000-0000-7000-8000-000000000101";
const SACK = "018f0000-0000-7000-8000-000000000102";
const BOX = "018f0000-0000-7000-8000-000000000103";

const stored = (id: string, content: string, gtin: string | null = null, brand = "MOÇA") => ({
  id,
  brand,
  content,
  gtin,
});
const write = (id: string | undefined, content: string, gtin: string | null = null, brand = "MOÇA") => ({
  ...(id === undefined ? {} : { id }),
  brand,
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

  it("changes a packaging only after the one holding its new brand and content has moved away", () => {
    const plan = planPackagingSync(
      [stored(BAG, "0.395", null, "MOÇA"), stored(SACK, "0.395", null, "ITALAC")],
      [write(BAG, "0.395", null, "ITALAC"), write(SACK, "0.395", null, "PIRACANJUBA")],
    );

    expect(plan.updates.map(({ id }) => id)).toEqual([SACK, BAG]);
  });

  it("lets the same content under different brands be written in any order", () => {
    const plan = planPackagingSync(
      [stored(BAG, "0.395", null, "MOÇA"), stored(SACK, "1", null, "ITALAC")],
      [write(BAG, "0.395", null, "MOÇA"), write(SACK, "0.395", null, "ITALAC")],
    );

    expect(plan.updates.map(({ id }) => id)).toEqual([BAG, SACK]);
  });

  it("renames a brand while a new packaging takes the old pair", () => {
    const plan = planPackagingSync(
      [stored(BAG, "0.395", null, "MOÇA")],
      [write(BAG, "0.395", null, "ITALAC"), write(undefined, "0.395", null, "MOÇA")],
    );

    expect(plan.updates).toEqual([write(BAG, "0.395", null, "ITALAC")]);
    expect(plan.creates).toEqual([write(undefined, "0.395", null, "MOÇA")]);
  });

  it("still lists both sides of a swap, which no order can save", () => {
    const plan = planPackagingSync([stored(BAG, "1"), stored(SACK, "5")], [write(BAG, "5"), write(SACK, "1")]);

    expect(plan.updates.map(({ id }) => id).sort()).toEqual([BAG, SACK].sort());
  });
});
