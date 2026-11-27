import { describe, expect, it } from "vitest";
import { addReserved, reservedBy } from "./plan-reservation";

const bought = (sku: string, plannedQuantity: string) => ({ product: { sku }, plannedQuantity, manufactured: null });
const made = (
  sku: string,
  plannedQuantity: string,
  toProduce: string,
  stage: Parameters<typeof reservedBy>[0] | null = null,
) => ({ product: { sku }, plannedQuantity, manufactured: { toProduce, stage } });

describe("reservedBy", () => {
  it("takes from stock what an intermediate needs beyond what the plan makes of it", () => {
    expect(reservedBy({ items: [bought("milk", "1"), made("filling", "0.5", "0")] })).toEqual({ filling: "0.5" });
    expect(reservedBy({ items: [made("filling", "0.5", "0.2")] })).toEqual({ filling: "0.3" });
  });

  it("is negative for what the plan makes beyond the need, and zero when it makes exactly that", () => {
    expect(reservedBy({ items: [made("filling", "0.5", "0.8")] })).toEqual({ filling: "-0.3" });
    expect(reservedBy({ items: [made("filling", "0.5", "0.5")] })).toEqual({ filling: "0" });
  });

  it("sums every place of the tree, counting what is made once, at any depth", () => {
    const shell = { items: [made("tempered", "0.25", "0.25"), made("filling", "0.1", "0.4")] };

    expect(reservedBy({ items: [made("filling", "0.5", "0.4"), made("shell", "25", "25", shell)] })).toEqual({
      filling: "0.2",
      shell: "0",
      tempered: "0",
    });
  });

  it("reads amounts that are decimals rather than strings", () => {
    const decimal = (value: string) => ({ toFixed: () => value });

    const filling = { product: { sku: "filling" }, plannedQuantity: decimal("0.5") };

    expect(reservedBy({ items: [{ ...filling, manufactured: { toProduce: decimal("0.125"), stage: null } }] })).toEqual(
      {
        filling: "0.375",
      },
    );
  });
});

describe("addReserved", () => {
  it("adds what two plans reserve, product by product", () => {
    expect(addReserved({ filling: "0.5", shell: "-2" }, { filling: "0.25", tempered: "1" })).toEqual({
      filling: "0.75",
      shell: "-2",
      tempered: "1",
    });
  });
});
