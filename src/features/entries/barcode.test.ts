import { describe, expect, it } from "vitest";
import { aPackaging, aProduct } from "@/tests/samples";
import { findByGtin } from "./barcode";

const BAG = aPackaging({ id: "018f0000-0000-7000-8000-000000000101", content: "0.38", gtin: "7891000100103" });
const OLD_BAG = aPackaging({
  id: "018f0000-0000-7000-8000-000000000102",
  content: "1",
  gtin: "78910003",
  isActive: false,
});
const FLOUR = aProduct({ sku: "018f0000-0000-7000-8000-000000000020", packagings: [BAG, OLD_BAG] });
const RETIRED = aProduct({
  sku: "018f0000-0000-7000-8000-000000000021",
  isActive: false,
  packagings: [aPackaging({ id: "018f0000-0000-7000-8000-000000000103", gtin: "17891000100100" })],
});

describe("findByGtin", () => {
  it("finds the product and the packaging a GTIN is printed on", () => {
    expect(findByGtin([RETIRED, FLOUR], " 7891000100103 ")).toEqual({ product: FLOUR, packaging: BAG });
  });

  it("ignores an inactive packaging and an inactive product", () => {
    expect(findByGtin([FLOUR, RETIRED], "78910003")).toBeNull();
    expect(findByGtin([FLOUR, RETIRED], "17891000100100")).toBeNull();
  });

  it("answers null for a GTIN no packaging has", () => {
    expect(findByGtin([FLOUR], "0000000000000")).toBeNull();
  });
});
