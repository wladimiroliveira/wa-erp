import { ProductKind } from "@prisma/client";
import { fail, succeed, type Result } from "@/server/lib/result";
import {
  findProductsBySku,
  findRecipeByProductSku,
  findRecipeSummaries,
  saveRecipe,
  type RecipeRecord,
  type RecipeSummaryRecord,
} from "./recipes.repository";

export const toRecipe = (recipe: RecipeRecord) => ({
  product: recipe.product,
  yieldQuantity: recipe.yieldQuantity.toString(),
  ingredients: recipe.ingredients.map(({ product, quantity }) => ({ product, quantity: quantity.toString() })),
  updatedAt: recipe.updatedAt.toISOString(),
});

export type Recipe = ReturnType<typeof toRecipe>;

const toSummary = (recipe: RecipeSummaryRecord) => ({
  product: recipe.product,
  yieldQuantity: recipe.yieldQuantity.toString(),
  ingredientCount: recipe._count.ingredients,
  updatedAt: recipe.updatedAt.toISOString(),
});

export type RecipeSummary = ReturnType<typeof toSummary>;

export async function listRecipes(): Promise<RecipeSummary[]> {
  return (await findRecipeSummaries()).map(toSummary);
}

export async function readRecipe(productSku: string): Promise<Result<Recipe, 404>> {
  const recipe = await findRecipeByProductSku(productSku);

  if (recipe === null) return fail(404, "Recipe not found.");

  return succeed(toRecipe(recipe));
}

export async function defineRecipe(
  productSku: string,
  input: { yieldQuantity: string; ingredients: { productSku: string; quantity: string }[] },
): Promise<Result<Recipe, 404 | 409>> {
  const [product] = await findProductsBySku([productSku]);

  if (product === undefined) return fail(404, "Product not found.");

  if (!product.isActive) return fail(409, "Product is inactive.");

  if (product.kind !== ProductKind.MANUFACTURED) return fail(409, "Only a manufactured product has a recipe.");

  const { ingredients } = input;
  const ingredientProducts = await findProductsBySku(ingredients.map((ingredient) => ingredient.productSku));

  if (ingredientProducts.length !== ingredients.length) return fail(404, "Ingredient product not found.");

  if (ingredientProducts.some((ingredient) => !ingredient.isActive))
    return fail(409, "Ingredient product is inactive.");

  const recipe = await saveRecipe({ productSku, ...input });

  if (recipe === null) {
    return fail(409, "A product cannot be an ingredient of itself, directly or through another recipe.");
  }

  return succeed(toRecipe(recipe));
}
