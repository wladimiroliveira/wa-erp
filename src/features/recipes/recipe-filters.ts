import type { Product, RecipeSummary } from "@/lib/api";
import { readList, readText, withValues } from "@/lib/url-filters";

/** A product that takes a recipe, beside the summary of the one it has, if any. */
export interface RecipeRow {
  product: Product;
  summary: RecipeSummary | undefined;
}

/** What the recipe filter offers. `ALL` exists only in the screen: the plain address lists every product. */
export const RECIPE_CHOICES = ["ALL", "WITH", "WITHOUT"] as const;

export type RecipeChoice = (typeof RECIPE_CHOICES)[number];

const RECIPE_LABELS: Record<RecipeChoice, string> = {
  ALL: "Todas",
  WITH: "Com receita",
  WITHOUT: "Sem receita",
};

export function recipeChoiceLabel(choice: RecipeChoice): string {
  return RECIPE_LABELS[choice];
}

export interface RecipeFilters {
  /** Part of the description of the product. */
  q?: string;
  recipe: RecipeChoice;
}

const DEFAULT_RECIPE: RecipeChoice = "ALL";

const FILTER_KEYS = ["q", "recipe"] as const;

/** The filters the address asks for. A value it does not know is ignored. */
export function readRecipeFilters(params: URLSearchParams): RecipeFilters {
  const q = readText(params, "q");
  const recipe = readList(params, "recipe", RECIPE_CHOICES)[0] ?? DEFAULT_RECIPE;

  return q === undefined ? { recipe } : { q, recipe };
}

/** Whether the address narrows the list beyond what it opens with. */
export function hasRecipeFilters(params: URLSearchParams): boolean {
  return FILTER_KEYS.some((key) => params.has(key));
}

export function withRecipeChoice(params: URLSearchParams, choice: RecipeChoice): URLSearchParams {
  return withValues(params, "recipe", choice === DEFAULT_RECIPE ? [] : [choice]);
}

export function withoutRecipeFilters(params: URLSearchParams): URLSearchParams {
  return FILTER_KEYS.reduce((next, key) => withValues(next, key, []), params);
}

// Typed without accents or capitals, a search still finds "Pão francês".
const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");

/** The rows the filters keep. Both lists are whole on the client, so narrowing them asks the API for nothing. */
export function filterRecipeRows(rows: RecipeRow[], { q, recipe }: RecipeFilters): RecipeRow[] {
  const search = q === undefined ? undefined : folded(q);

  return rows.filter(
    ({ product, summary }) =>
      (search === undefined || folded(product.description).includes(search)) &&
      (recipe === "ALL" || (recipe === "WITH") === (summary !== undefined)),
  );
}
