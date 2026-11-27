import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { outflowValues } from "./stock-outflows.values";

const D = (value: string) => new Prisma.Decimal(value);
const takes = [
  { quantity: D("2"), unitCost: D("10") },
  { quantity: D("1"), unitCost: D("6") },
];

describe("outflowValues", () => {
  it("gives cost, revenue and profit of a sale", () => {
    expect(outflowValues({ kind: "SALE", quantity: D("3"), unitPrice: D("13.80"), takes })).toEqual({
      cost: "26.00",
      revenue: "41.40",
      profit: "15.40",
    });
  });

  it("gives only the cost of a donation", () => {
    expect(outflowValues({ kind: "DONATION", quantity: D("3"), unitPrice: null, takes })).toEqual({
      cost: "26.00",
      revenue: null,
      profit: null,
    });
  });

  it("rounds half up and takes the profit from the rounded amounts", () => {
    expect(
      outflowValues({
        kind: "SALE",
        quantity: D("1"),
        unitPrice: D("1.01"),
        takes: [{ quantity: D("1"), unitCost: D("0.005") }],
      }),
    ).toEqual({ cost: "0.01", revenue: "1.01", profit: "1.00" });
  });
});
