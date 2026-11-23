import { describe, expect, it } from "vitest";
import { itemStateLabel, itemsAsTree } from "@/features/productions/item-state";
import { aProductionItem } from "@/tests/samples";

const product = (description: string) => ({ sku: description, description, unit: "KILOGRAM" as const });
const SHELL = aProductionItem({ id: "shell", product: product("Casquinha") });
const FILLING = aProductionItem({ id: "filling", product: product("Recheio") });
const BOMBOM = aProductionItem({ id: "bombom", product: product("Bombom"), dependsOn: ["filling", "shell"] });

describe("itemStateLabel", () => {
  it("says a finished item is finished", () => {
    const item = { ...FILLING, status: "FINISHED" as const };

    expect(itemStateLabel(item, [item], "IN_PROGRESS")).toBe("Finalizado");
  });

  it("says a substituted item was replaced by the stock", () => {
    const item = { ...FILLING, status: "SUBSTITUTED" as const };

    expect(itemStateLabel(item, [item], "IN_PROGRESS")).toBe("Substituído pelo estoque");
  });

  it("says a damaged item waits for a new weighing", () => {
    const item = { ...FILLING, awaitsWeighing: true };

    expect(itemStateLabel(item, [item], "IN_PROGRESS")).toBe("Avariado — aguardando nova pesagem");
  });

  it("names the pending items an item waits for", () => {
    expect(itemStateLabel(BOMBOM, [BOMBOM, SHELL, FILLING], "IN_PROGRESS")).toBe("Aguardando Casquinha, Recheio");
  });

  it("does not wait for items already finished", () => {
    const done = { ...SHELL, status: "FINISHED" as const };

    expect(itemStateLabel(BOMBOM, [BOMBOM, done, FILLING], "IN_PROGRESS")).toBe("Aguardando Recheio");
  });

  it("is to be produced when nothing is in the way", () => {
    expect(
      itemStateLabel(
        BOMBOM,
        [BOMBOM, { ...SHELL, status: "FINISHED" }, { ...FILLING, status: "FINISHED" }],
        "IN_PROGRESS",
      ),
    ).toBe("A produzir");
  });

  it.each([
    [
      "to be produced",
      BOMBOM,
      [BOMBOM, { ...SHELL, status: "FINISHED" as const }, { ...FILLING, status: "FINISHED" as const }],
    ],
    ["waiting for others", BOMBOM, [BOMBOM, SHELL, FILLING]],
    ["damaged", { ...FILLING, awaitsWeighing: true }, [{ ...FILLING, awaitsWeighing: true }]],
  ])("says a pending item %s of a canceled production was not produced", (_label, item, items) => {
    expect(itemStateLabel(item, items, "CANCELED")).toBe("Não produzido");
  });

  it("keeps a finished item of a canceled production finished", () => {
    const item = { ...FILLING, status: "FINISHED" as const };

    expect(itemStateLabel(item, [item], "CANCELED")).toBe("Finalizado");
  });
});

describe("itemsAsTree", () => {
  it("puts an item under the items that take it, roots first, with its depth", () => {
    const tree = itemsAsTree([SHELL, BOMBOM, FILLING]);

    expect(tree.map(({ item, depth }) => [item.id, depth])).toEqual([
      ["bombom", 0],
      ["filling", 1],
      ["shell", 1],
    ]);
  });

  it("lists an item once even when two items take it", () => {
    const top = aProductionItem({ id: "top", dependsOn: ["bombom", "shell"] });
    const tree = itemsAsTree([top, BOMBOM, SHELL, FILLING]);

    expect(tree.map(({ item }) => item.id).sort()).toEqual(["bombom", "filling", "shell", "top"]);
  });
});
