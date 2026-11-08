import { describe, expect, it } from "vitest";
import { filterPricingRows, readPricingFilters } from "@/features/pricing/pricing-filters";
import { aPricingRow } from "@/tests/samples";

const BREAD = aPricingRow();
const CAKE = aPricingRow({
  product: { sku: "018f0000-0000-7000-8000-000000000091", description: "Bolo de fubá", unit: "UNIT" },
});

describe("pricing filters", () => {
  it("finds Pão francês typing pao", () => {
    expect(filterPricingRows([BREAD, CAKE], readPricingFilters(new URLSearchParams("q=pao")))).toEqual([BREAD]);
  });

  it("keeps every row without a search", () => {
    expect(filterPricingRows([BREAD, CAKE], readPricingFilters(new URLSearchParams()))).toEqual([BREAD, CAKE]);
  });
});
