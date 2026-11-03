import { describe, expect, it } from "vitest";
import {
  filterRecipeRows,
  hasRecipeFilters,
  readRecipeFilters,
  withoutRecipeFilters,
  withRecipeChoice,
} from "@/features/recipes/recipe-filters";
import { aProduct, aRecipeSummary } from "@/tests/samples";

const BREAD = aProduct({ sku: "sku-1", description: "Pão francês", kind: "MANUFACTURED" });
const CAKE = aProduct({ sku: "sku-2", description: "Bolo de fubá", kind: "MANUFACTURED" });
const ROWS = [
  { product: BREAD, summary: aRecipeSummary() },
  { product: CAKE, summary: undefined },
];

describe("recipe filters", () => {
  it("reads every product, with or without a recipe, from a plain address", () => {
    expect(readRecipeFilters(new URLSearchParams())).toEqual({ recipe: "ALL" });
    expect(hasRecipeFilters(new URLSearchParams())).toBe(false);
  });

  it("reads the search and the recipe choice, ignoring one it does not know", () => {
    expect(readRecipeFilters(new URLSearchParams("q=+pão+&recipe=WITHOUT"))).toEqual({ q: "pão", recipe: "WITHOUT" });
    expect(readRecipeFilters(new URLSearchParams("recipe=MAYBE"))).toEqual({ recipe: "ALL" });
  });

  it("keeps the default choice out of the address, and clears only its own keys", () => {
    expect(withRecipeChoice(new URLSearchParams("recipe=WITH"), "ALL").toString()).toBe("");
    expect(withRecipeChoice(new URLSearchParams(), "WITH").toString()).toBe("recipe=WITH");
    expect(withoutRecipeFilters(new URLSearchParams("q=pão&recipe=WITH&other=1")).toString()).toBe("other=1");
    expect(hasRecipeFilters(new URLSearchParams("recipe=WITH"))).toBe(true);
  });

  it("finds a product by part of its description, whatever the case and the accents", () => {
    expect(filterRecipeRows(ROWS, { q: "PAO", recipe: "ALL" }).map((row) => row.product)).toEqual([BREAD]);
  });

  it("keeps the products with, or the ones without, a recipe", () => {
    expect(filterRecipeRows(ROWS, { recipe: "WITH" }).map((row) => row.product)).toEqual([BREAD]);
    expect(filterRecipeRows(ROWS, { recipe: "WITHOUT" }).map((row) => row.product)).toEqual([CAKE]);
    expect(filterRecipeRows(ROWS, { recipe: "ALL" })).toEqual(ROWS);
  });
});
