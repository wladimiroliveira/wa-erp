"use server";

import { Permission } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import {
  createProductBodySchema,
  productParamsSchema,
  updateProductBodySchema,
} from "@/server/modules/products/products.schemas";
import { createProduct as insert, editProduct } from "@/server/modules/products/products.service";
import type { CreateProductBody, Product, UpdateProductBody } from "@/lib/api";

export type ProductResult = { ok: true; data: Product } | Failure;

const INVALID_INPUT = "Invalid input.";
const DENIED = "Permission denied.";

// Whatever shows a product reads the catalog again: the stock shows its description and reads its
// minimum into the status, and the recipes list the manufactured ones.
function revalidateCatalog(): void {
  for (const path of ["/products", "/recipes", "/stock"]) revalidatePath(path);
}

export async function createProduct(body: CreateProductBody): Promise<ProductResult> {
  const user = await requireUser();

  if (!can(user, Permission.CATALOG_CREATE)) return fail(403, DENIED);

  const parsed = createProductBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  const result = await insert(parsed.data);

  if (result.ok) revalidateCatalog();

  return result;
}

export async function updateProduct(sku: string, body: UpdateProductBody): Promise<ProductResult> {
  const user = await requireUser();

  if (!can(user, Permission.CATALOG_UPDATE)) return fail(403, DENIED);

  const params = productParamsSchema.safeParse({ sku });
  const parsed = updateProductBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await editProduct(params.data.sku, parsed.data);

  if (result.ok) revalidateCatalog();

  return result;
}
