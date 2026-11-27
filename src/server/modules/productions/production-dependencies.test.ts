import { describe, expect, it } from "vitest";

import { dependenciesOf, waitingFor, type DependencyItem } from "./production-dependencies";

const item = (
  id: string,
  productSku: string,
  inputSkus: string[] = [],
  status: DependencyItem["status"] = "PENDING",
): DependencyItem => ({ id, productSku, status, inputSkus });

describe("dependenciesOf", () => {
  it("links a product to the items that produce its inputs", () => {
    const items = [
      item("bombom", "BOMBOM", ["recheio", "casquinha", "sprinkles"]),
      item("recheio", "RECHEIO"),
      item("casquinha", "CASQUINHA"),
    ];
    const result = dependenciesOf(items);
    expect(result.get("bombom")).toEqual(["recheio", "casquinha"]);
    expect(result.get("recheio")).toEqual([]);
    expect(result.get("casquinha")).toEqual([]);
  });

  it("supports an intermediate that takes another intermediate", () => {
    const items = [item("casquinha", "casquinha", ["recheio"]), item("recheio", "recheio")];
    expect(dependenciesOf(items).get("casquinha")).toEqual(["recheio"]);
  });

  it("waits for both the original and the complement item", () => {
    const items = [item("bombom", "bombom", ["recheio"]), item("r1", "recheio"), item("r2", "recheio")];
    expect(dependenciesOf(items).get("bombom")).toEqual(["r1", "r2"]);
  });

  it("matches SKUs regardless of case", () => {
    const items = [item("a", "A", ["Recheio"]), item("r", "RECHEIO")];
    expect(dependenciesOf(items).get("a")).toEqual(["r"]);
  });
});

describe("waitingFor", () => {
  it("drops finished and substituted dependencies", () => {
    const items = [
      item("bombom", "bombom", ["r", "c", "s"]),
      item("r1", "r", [], "FINISHED"),
      item("r2", "r", [], "PENDING"),
      item("c1", "c", [], "SUBSTITUTED"),
    ];
    expect(waitingFor("bombom", items)).toEqual(["r2"]);
  });

  it("returns nothing for an unknown item", () => {
    expect(waitingFor("x", [])).toEqual([]);
  });
});
