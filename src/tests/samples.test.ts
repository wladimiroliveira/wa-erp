import { describe, expect, it } from "vitest";
import { aProductionBatch, aProductionItem } from "@/tests/samples";

describe("production samples", () => {
  it("an item comes with no batches and no extra weighings", () => {
    expect(aProductionItem()).toMatchObject({ batches: [], extraWeighings: 0 });
  });

  it("a batch is typed as the item's batches are", () => {
    const item = aProductionItem({ batches: [aProductionBatch({ source: "EXISTING" })] });

    expect(item.batches[0]).toMatchObject({ source: "EXISTING", expiresAt: null });
  });
});
