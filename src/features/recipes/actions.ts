"use server";

import { Permission } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, succeed, type Failure } from "@/server/lib/result";
import { recipeParamsSchema, saveRecipeBodySchema } from "@/server/modules/recipes/recipes.schemas";
import { defineRecipe, readRecipe as read } from "@/server/modules/recipes/recipes.service";
import type { Recipe, SaveRecipeBody } from "@/lib/api";

export type RecipeResult = { ok: true; data: Recipe } | Failure;

const INVALID_INPUT = "Invalid input.";

/** The recipe of a product, read when the sheet opens. A product with no recipe yet is an answer, not a failure: `null`. */
export async function readRecipe(productSku: string): Promise<{ ok: true; data: Recipe | null } | Failure> {
  const user = await requireUser();

  if (!can(user, Permission.CATALOG_READ)) return fail(403, "Permission denied.");

  const params = recipeParamsSchema.safeParse({ sku: productSku });

  if (!params.success) return fail(400, INVALID_INPUT);

  const result = await read(params.data.sku);

  if (!result.ok) return result.status === 404 ? succeed(null) : result;

  return succeed(result.data);
}

export async function saveRecipe(productSku: string, body: SaveRecipeBody): Promise<RecipeResult> {
  const user = await requireUser();

  if (!can(user, Permission.CATALOG_UPDATE)) return fail(403, "Permission denied.");

  const params = recipeParamsSchema.safeParse({ sku: productSku });
  const parsed = saveRecipeBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await defineRecipe(params.data.sku, parsed.data);

  if (result.ok) revalidatePath("/recipes");

  return result;
}
