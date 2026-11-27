import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { consumptionOf, lotsOf } from "./production-batches";

const D = (value: string) => new Prisma.Decimal(value);

type Batch = { quantity: Prisma.Decimal; source: "PRODUCED" | "EXISTING" };

const produced = (quantity: string): Batch => ({ quantity: D(quantity), source: "PRODUCED" });
const existing = (quantity: string): Batch => ({ quantity: D(quantity), source: "EXISTING" });

// 100 bonbons out of 2 kg of filling taken from stock unweighed and 0.5 kg of sprinkles weighed.
const bonbons = (batches: Batch[], expected = "100") => ({
  expectedQuantity: D(expected),
  extraPlanned: D("0"),
  inputs: [
    { id: "filling", quantity: D("2"), weighed: false },
    { id: "sprinkles", quantity: D("0.5"), weighed: true },
  ],
  batches,
});

const shown = (consumption: { inputId: string; quantity: Prisma.Decimal }[]) =>
  consumption.map(({ inputId, quantity }) => [inputId, quantity.toString()]);

describe("consumptionOf", () => {
  it("takes every input whole when the batches were all made now", () => {
    expect(shown(consumptionOf(bonbons([produced("100")]), { mainBelowTarget: false }))).toEqual([
      ["filling", "2"],
      ["sprinkles", "0.5"],
    ]);
  });

  it("leaves the share of the target that already existed in stock: 25 existing of 50 takes half", () => {
    const item = bonbons([produced("25"), existing("25")], "50");

    expect(shown(consumptionOf(item, { mainBelowTarget: false }))).toEqual([
      ["filling", "1"],
      ["sprinkles", "0.25"],
    ]);
  });

  it("takes for what was made now when what existed already reaches the target: 50 existing and 10 made of 50", () => {
    // A fifth of every input went into the 10 made, so their lot carries a cost.
    const item = bonbons([existing("50"), produced("10")], "50");

    expect(shown(consumptionOf(item, { mainBelowTarget: false }))).toEqual([
      ["filling", "0.4"],
      ["sprinkles", "0.1"],
    ]);
  });

  it("takes nothing when everything already existed, even beyond the target", () => {
    expect(consumptionOf(bonbons([existing("100")]), { mainBelowTarget: false })).toEqual([]);
    expect(consumptionOf(bonbons([existing("60"), existing("60")]), { mainBelowTarget: false })).toEqual([]);
  });

  it("takes nothing when nothing was made now, even below the target: 20 existing of 50", () => {
    const item = bonbons([existing("20")], "50");

    expect(consumptionOf(item, { mainBelowTarget: false })).toEqual([]);
    expect(consumptionOf(item, { mainBelowTarget: true })).toEqual([]);
  });

  it("never scales an input up when more was made than expected", () => {
    expect(shown(consumptionOf(bonbons([produced("120")]), { mainBelowTarget: false }))).toEqual([
      ["filling", "2"],
      ["sprinkles", "0.5"],
    ]);
  });

  it("takes of the main product's unweighed lines only what was made, and its weighed lines whole: 80 of 100", () => {
    expect(shown(consumptionOf(bonbons([produced("80")]), { mainBelowTarget: true }))).toEqual([
      ["filling", "1.6"],
      ["sprinkles", "0.5"],
    ]);
  });

  it("combines what existed with a main product below target: 60 made and 20 existing of 100", () => {
    // The weighed lines leave for the 80 that had to be made; the unweighed ones for the 60 made.
    expect(shown(consumptionOf(bonbons([produced("60"), existing("20")]), { mainBelowTarget: true }))).toEqual([
      ["filling", "1.2"],
      ["sprinkles", "0.4"],
    ]);
  });

  it("takes of the main product's unweighed lines what was made of all it was weighed for, extra weighings too", () => {
    // 100 expected and one more leva weighed for 20: 2.4 kg of filling for 120, 90 made take 1.8.
    const item = {
      expectedQuantity: D("100"),
      extraPlanned: D("20"),
      inputs: [
        { id: "filling", quantity: D("2.4"), weighed: false },
        { id: "sprinkles", quantity: D("0.6"), weighed: true },
      ],
      batches: [produced("90")],
    };

    expect(shown(consumptionOf(item, { mainBelowTarget: true }))).toEqual([
      ["filling", "1.8"],
      ["sprinkles", "0.6"],
    ]);
  });

  it("keeps each quantity to the places the stock holds, and drops one that rounds to nothing", () => {
    const item = {
      expectedQuantity: D("3"),
      extraPlanned: D("0"),
      inputs: [
        { id: "a", quantity: D("1"), weighed: true },
        { id: "b", quantity: D("0.000001"), weighed: true },
      ],
      batches: [produced("1"), existing("2")],
    };

    expect(shown(consumptionOf(item, { mainBelowTarget: false }))).toEqual([["a", "0.333333"]]);
  });
});

describe("lotsOf", () => {
  const batch = (quantity: string, expiresAt: string | null, source: "PRODUCED" | "EXISTING" = "PRODUCED") => ({
    quantity: D(quantity),
    expiresAt,
    source,
  });

  it("sums the batches of each expiry, apart by where they came from, in the order the expiries first came", () => {
    const lots = lotsOf([
      batch("10", "2026-12-01"),
      batch("5", "2026-12-08"),
      batch("7", "2026-12-01"),
      batch("3", "2026-12-01", "EXISTING"),
      batch("2", null, "EXISTING"),
    ]);

    expect(
      lots.map(({ expiresAt, produced: made, existing: found }) => [expiresAt, made.toString(), found.toString()]),
    ).toEqual([
      ["2026-12-01", "17", "3"],
      ["2026-12-08", "5", "0"],
      [null, "0", "2"],
    ]);
  });

  it("has no lot without a batch", () => {
    expect(lotsOf([])).toEqual([]);
  });
});
