import { describe, expect, it } from "vitest";
import { aPreWeighingPlan } from "@/tests/samples";
import { createBodyOf, weighingRowsOf } from "./plan-tree";

const sku = (n: number) => `018f0000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;
const product = (n: number) => ({ sku: sku(n), description: `P${n}`, unit: "KILOGRAM" as const });
const bought = (n: number, planned: string) => ({
  product: product(n),
  plannedQuantity: planned,
  lots: [],
  shortfall: "0",
  manufactured: null,
});

function twoLevelPlan() {
  const stage = aPreWeighingPlan({ product: product(2), quantity: "3", items: [bought(3, "1"), bought(4, "2")] });

  return aPreWeighingPlan({
    product: product(1),
    quantity: "10",
    items: [
      bought(5, "6"),
      {
        ...bought(2, "3"),
        manufactured: { needed: "3", inStock: "0", toProduce: "3", stage },
      },
      {
        ...bought(6, "1"),
        manufactured: { needed: "1", inStock: "1", toProduce: "0", stage: null },
      },
    ],
  });
}

describe("weighingRowsOf", () => {
  it("lists the bought lines depth first with the path of stages", () => {
    const rows = weighingRowsOf(twoLevelPlan());

    expect(rows.map((r) => [r.path, r.product.sku, r.plannedQuantity])).toEqual([
      [[sku(1)], sku(5), "6"],
      [[sku(1), sku(2)], sku(3), "1"],
      [[sku(1), sku(2)], sku(4), "2"],
    ]);
  });
});

describe("createBodyOf", () => {
  it("puts each weighed value in its stage and omits it on manufactured lines", () => {
    const body = createBodyOf(twoLevelPlan(), ["6.1", "1.1", "2.2"]);

    expect(body).toEqual({
      productSku: sku(1),
      quantity: "10",
      items: [{ productSku: sku(5), weighedQuantity: "6.1" }, { productSku: sku(2) }, { productSku: sku(6) }],
      stages: [
        {
          productSku: sku(2),
          quantity: "3",
          items: [
            { productSku: sku(3), weighedQuantity: "1.1" },
            { productSku: sku(4), weighedQuantity: "2.2" },
          ],
          stages: [],
        },
      ],
    });
  });

  it("passes parentId through", () => {
    const body = createBodyOf(aPreWeighingPlan(), ["6"], "018f0000-0000-7000-8000-0000000000ff");

    expect(body.parentId).toBe("018f0000-0000-7000-8000-0000000000ff");
  });
});
