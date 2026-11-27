import { Prisma } from "@prisma/client";

const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** What an outflow cost and, for a sale, what it brought in. Profit comes from the rounded amounts. */
export function outflowValues(input: {
  kind: "SALE" | "DONATION";
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
  takes: { quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[];
}): { cost: string; revenue: string | null; profit: string | null } {
  const cost = money(
    input.takes.reduce((sum, take) => sum.plus(take.quantity.times(take.unitCost)), new Prisma.Decimal(0)),
  );

  if (input.kind === "DONATION" || input.unitPrice === null) {
    return { cost: cost.toFixed(2), revenue: null, profit: null };
  }

  const revenue = money(input.quantity.times(input.unitPrice));

  return { cost: cost.toFixed(2), revenue: revenue.toFixed(2), profit: revenue.minus(cost).toFixed(2) };
}
