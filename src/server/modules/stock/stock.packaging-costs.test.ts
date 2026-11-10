import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { packagingCostsOf } from "./stock.packaging-costs";

const MILL = { id: "018f0000-0000-7000-8000-000000000401", name: "Moinho Santa Clara" };

const lot = (id: string, createdAt: string, price: string | null, count = 10, supplier: typeof MILL | null = MILL) => ({
  id,
  createdAt: new Date(createdAt),
  packageCount: count,
  packagePrice: price === null ? null : new Prisma.Decimal(price),
  supplier,
});

const packaging = (id: string, content: string, isActive: boolean, lots: ReturnType<typeof lot>[], brand = "MOÇA") => ({
  id,
  brand,
  content: new Prisma.Decimal(content),
  isActive,
  lots,
});

describe("packagingCostsOf", () => {
  it("lists the entries of a packaging newest first, the newest as its last entry", () => {
    const [bag] = packagingCostsOf([
      packaging("bag", "380", true, [
        lot("old", "2026-10-01T12:00:00Z", "12.50", 5, null),
        lot("new", "2026-11-05T12:00:00Z", "12.91"),
      ]),
    ]);

    expect(bag).toEqual({
      id: "bag",
      brand: "MOÇA",
      content: "380",
      isActive: true,
      lastEntry: { price: "12.91", createdAt: "2026-11-05T12:00:00.000Z", supplier: MILL },
      history: [
        { lotId: "new", createdAt: "2026-11-05T12:00:00.000Z", supplier: MILL, count: 10, price: "12.91" },
        { lotId: "old", createdAt: "2026-10-01T12:00:00.000Z", supplier: null, count: 5, price: "12.5" },
      ],
    });
  });

  it("keeps an active packaging that never came in, with no last entry", () => {
    expect(packagingCostsOf([packaging("box", "1000", true, [])])).toEqual([
      { id: "box", brand: "MOÇA", content: "1000", isActive: true, lastEntry: null, history: [] },
    ]);
  });

  it("leaves out an inactive packaging that never came in, and keeps one that did", () => {
    const costs = packagingCostsOf([
      packaging("unused", "500", false, []),
      packaging("retired", "250", false, [lot("a", "2026-10-01T12:00:00Z", "9")]),
    ]);

    expect(costs.map(({ id }) => id)).toEqual(["retired"]);
  });

  it("orders the packagings by content, the smallest first", () => {
    const costs = packagingCostsOf([
      packaging("sack", "5000", true, []),
      packaging("bag", "380", true, []),
      packaging("box", "1000", true, []),
    ]);

    expect(costs.map(({ id }) => id)).toEqual(["bag", "box", "sack"]);
  });

  it("skips a lot that has no count or price", () => {
    const [bag] = packagingCostsOf([packaging("bag", "380", true, [lot("a", "2026-10-01T12:00:00Z", null)])]);

    expect(bag).toMatchObject({ lastEntry: null, history: [] });
  });

  it("orders by brand, then content", () => {
    const costs = packagingCostsOf([
      packaging("moça-1", "1", true, [], "MOÇA"),
      packaging("italac-1", "1", true, [], "ITALAC"),
      packaging("moça-395", "0.395", true, [], "MOÇA"),
    ]);

    expect(costs.map(({ id, brand }) => [id, brand])).toEqual([
      ["italac-1", "ITALAC"],
      ["moça-395", "MOÇA"],
      ["moça-1", "MOÇA"],
    ]);
  });
});
