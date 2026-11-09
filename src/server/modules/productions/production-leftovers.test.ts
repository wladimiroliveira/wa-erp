import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { leftoverOf, splitLeftover } from "./production-leftovers";

const D = (value: string) => new Prisma.Decimal(value);

describe("leftoverOf", () => {
  it.each([
    ["3950", "300", "395", "95"],
    ["3950", "395", "395", "0"],
    ["3650", "300", "395", "190"],
    ["100", "100", "395", "0"],
    ["3950", "300", "0", "0"],
    ["100", "150", "395", "0"],
  ])("a lot of %s taken %s in packagings of %s leaves %s", (lot, taken, content, left) =>
    expect(leftoverOf(D(lot), D(taken), D(content)).toString()).toBe(left),
  );
});

describe("splitLeftover", () => {
  const shares = (left: string, takes: [string, string][]) =>
    splitLeftover(
      D(left),
      takes.map(([inputId, taken]) => ({ inputId, taken: D(taken) })),
    ).map(({ inputId, quantity }) => [inputId, quantity.toString()]);

  it("splits what is left of a shared can by what each input took", () =>
    expect(
      shares("195", [
        ["pudding", "100"],
        ["flan", "100"],
      ]),
    ).toEqual([
      ["pudding", "97.5"],
      ["flan", "97.5"],
    ]));

  it("keeps the shares to 6 places, the last one taking what rounding left", () =>
    expect(
      shares("100", [
        ["a", "1"],
        ["b", "2"],
      ]),
    ).toEqual([
      ["a", "33.333333"],
      ["b", "66.666667"],
    ]));

  it("leaves out a share that rounds to nothing", () =>
    expect(
      shares("0.000001", [
        ["a", "1"],
        ["b", "1"],
      ]),
    ).toEqual([["b", "0.000001"]]));

  it("splits nothing when nothing is left", () => expect(shares("0", [["a", "1"]])).toEqual([]));
});
