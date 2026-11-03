import { fail, succeed, type Result } from "@/server/lib/result";
import {
  findProductByDescription,
  findProductByGtin,
  findProductBySku,
  insertProduct,
  updateProduct,
} from "./products.repository";
import type { createProductBodySchema, updateProductBodySchema } from "./products.schemas";
import type { z } from "zod";

type Product = NonNullable<Awaited<ReturnType<typeof findProductBySku>>>;

const DESCRIPTION_TAKEN = "A product with this description already exists.";
const GTIN_TAKEN = "A product with this GTIN already exists.";

// Whether another product than `sku` already holds this description or GTIN. With no `sku`, any does.
async function conflictOf(input: { description?: string; gtin?: string | null }, sku?: string) {
  // The database answers a uuid in lower case, whatever case the request wrote it in.
  const takenBy = (found: { sku: string } | null) => found !== null && found.sku !== sku?.toLowerCase();

  if (input.description !== undefined && takenBy(await findProductByDescription(input.description))) {
    return DESCRIPTION_TAKEN;
  }

  if (input.gtin !== undefined && input.gtin !== null && takenBy(await findProductByGtin(input.gtin))) {
    return GTIN_TAKEN;
  }

  return null;
}

export async function createProduct(input: z.output<typeof createProductBodySchema>): Promise<Result<Product, 409>> {
  const conflict = await conflictOf(input);

  if (conflict !== null) return fail(409, conflict);

  return succeed(await insertProduct(input));
}

export async function editProduct(
  sku: string,
  changes: z.output<typeof updateProductBodySchema>,
): Promise<Result<Product, 404 | 409>> {
  if ((await findProductBySku(sku)) === null) return fail(404, "Product not found.");

  const conflict = await conflictOf(changes, sku);

  if (conflict !== null) return fail(409, conflict);

  return succeed(await updateProduct(sku, changes));
}
