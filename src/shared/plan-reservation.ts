import { fromScaled, toScaled } from "./fixed-point";

// A free production plans its items in order, each against the stock of its intermediates that the
// items before it leave. What a plan leaves is worked out here, on the server and on the screen alike.

const PLACES = 6;

/** A decimal as a string, or a decimal that writes itself as one. */
type Amount = string | { toFixed(): string };

/** A plan as far as what it takes of its intermediates: the root's lines and, under each intermediate made, its stage's. */
export type ReservingPlan = {
  items: {
    product: { sku: string };
    plannedQuantity: Amount;
    manufactured: { toProduce: Amount; stage: ReservingPlan | null } | null;
  }[];
};

/** What a plan takes of the stock of each intermediate, by SKU, as a decimal string; negative when it makes more than it takes. */
export type Reserved = Record<string, string>;

const scaledOf = (amount: Amount) => {
  const text = typeof amount === "string" ? amount : amount.toFixed();
  const negative = text.startsWith("-");
  const scaled = toScaled(negative ? text.slice(1) : text, PLACES);

  return negative ? -scaled : scaled;
};

const textOf = (scaled: bigint) => {
  const text = fromScaled(scaled < 0n ? -scaled : scaled, PLACES).replace(/\.?0+$/, "");

  return scaled < 0n ? `-${text}` : text;
};

/**
 * What a plan takes of the stock of each intermediate it reaches: what every place of its tree needs
 * of it, less what the plan makes of it (once, however many places take it).
 */
export function reservedBy(plan: ReservingPlan): Reserved {
  const needed = new Map<string, bigint>();
  const made = new Map<string, bigint>();
  const visit = (stage: ReservingPlan) => {
    for (const { product, plannedQuantity, manufactured } of stage.items) {
      if (manufactured === null) continue;

      needed.set(product.sku, (needed.get(product.sku) ?? 0n) + scaledOf(plannedQuantity));
      if (!made.has(product.sku)) made.set(product.sku, scaledOf(manufactured.toProduce));
      if (manufactured.stage !== null) visit(manufactured.stage);
    }
  };

  visit(plan);

  return Object.fromEntries([...needed].map(([sku, need]) => [sku, textOf(need - made.get(sku)!)]));
}

/** What two plans take of the stock together. */
export function addReserved(first: Reserved, second: Reserved): Reserved {
  const sum = new Map(Object.entries(first).map(([sku, amount]) => [sku, scaledOf(amount)]));

  for (const [sku, amount] of Object.entries(second)) sum.set(sku, (sum.get(sku) ?? 0n) + scaledOf(amount));

  return Object.fromEntries([...sum].map(([sku, amount]) => [sku, textOf(amount)]));
}
