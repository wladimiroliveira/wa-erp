import { describe, expect, it } from "vitest";
import { canDamage, canSubstitute } from "@/features/productions/item-state";
import { aProductionBatch, aProductionItem } from "@/tests/samples";

// The filling is taken by the bombom: it can go wrong now, and stock can stand in for it.
const filling = (over: Parameters<typeof aProductionItem>[0] = {}) =>
  aProductionItem({ id: "filling", dependsOn: [], ...over });
const bombom = aProductionItem({ id: "bombom", dependsOn: ["filling"] });

describe("canDamage and canSubstitute", () => {
  it("offer both on a pending intermediate nothing was made of yet", () => {
    const item = filling();

    expect(canDamage(item, [item, bombom])).toBe(true);
    expect(canSubstitute(item, [item, bombom])).toBe(true);
  });

  it("offer neither once the item has a batch", () => {
    const item = filling({ batches: [aProductionBatch()] });

    expect(canDamage(item, [item, bombom])).toBe(false);
    expect(canSubstitute(item, [item, bombom])).toBe(false);
  });

  it("offer neither once the item took an extra weighing", () => {
    const item = filling({ extraWeighings: 1 });

    expect(canDamage(item, [item, bombom])).toBe(false);
    expect(canSubstitute(item, [item, bombom])).toBe(false);
  });
});
