import { describe, expect, it } from "vitest";

import { aProductionBatch, aProductionItem } from "@/tests/samples";

import { progressOf, progressTextOf } from "./batch-progress";

const bombom = (quantities: string[], expectedQuantity = "50") =>
  aProductionItem({
    product: { sku: "sku-bombom", description: "Bombom", unit: "UNIT" },
    expectedQuantity,
    batches: quantities.map((quantity, index) => aProductionBatch({ id: `b-${index}`, quantity })),
  });

describe("progressOf", () => {
  it("adds the batches up and says how much is missing", () => {
    expect(progressOf(bombom(["20", "15"]))).toEqual({ produced: "35", missing: "15", reached: false });
  });

  it("starts at nothing, with all of it missing", () => {
    expect(progressOf(bombom([]))).toEqual({ produced: "0", missing: "50", reached: false });
  });

  it("reaches the target at exactly what was expected", () => {
    expect(progressOf(bombom(["30", "20"]))).toEqual({ produced: "50", missing: "0", reached: true });
  });

  it("misses nothing once past the target", () => {
    expect(progressOf(bombom(["60"]))).toEqual({ produced: "60", missing: "0", reached: true });
  });

  it("sums decimals exactly", () => {
    expect(progressOf(bombom(["0.1", "0.2"], "0.7"))).toEqual({ produced: "0.3", missing: "0.4", reached: false });
  });
});

describe("progressTextOf", () => {
  it("says how much of the target was made and what is missing", () => {
    expect(progressTextOf(bombom(["20", "15"]))).toBe("35 un de 50 un · faltam 15 un");
  });

  it("says the target was reached", () => {
    expect(progressTextOf(bombom(["50"]))).toBe("50 un de 50 un · meta atingida");
  });
});
