import { describe, expect, it } from "vitest";
import { hasProductFilters, readProductFilters } from "@/features/products/product-filters";

const read = (search: string) => readProductFilters(new URLSearchParams(search));

describe("product filters", () => {
  it("lists the active products when the address chooses nothing", () => {
    expect(read("")).toEqual({ status: "ACTIVE" });
  });

  it("reads the inactive products, or every product, when the address asks", () => {
    expect(read("status=INACTIVE")).toEqual({ status: "INACTIVE" });
    expect(read("status=ALL")).toEqual({});
  });

  it("falls back to the active products for a status it does not know", () => {
    expect(read("status=DELETED")).toEqual({ status: "ACTIVE" });
  });

  it("reads the search, the kinds and the units, ignoring values it does not know", () => {
    expect(read("q=%20farinha%20&kind=GOODS&kind=SERVICE&unit=GRAM&unit=KILOGRAM")).toEqual({
      q: "farinha",
      kind: ["GOODS"],
      unit: ["GRAM", "KILOGRAM"],
      status: "ACTIVE",
    });
  });

  it("tells whether the address filters anything beyond the default", () => {
    expect(hasProductFilters(new URLSearchParams(""))).toBe(false);
    expect(hasProductFilters(new URLSearchParams("page=2"))).toBe(false);
    expect(hasProductFilters(new URLSearchParams("status=ALL"))).toBe(true);
    expect(hasProductFilters(new URLSearchParams("q=pão"))).toBe(true);
  });
});
