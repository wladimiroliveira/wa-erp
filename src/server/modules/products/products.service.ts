import type { MeasurementUnit } from "@prisma/client";
import type { z } from "zod";
import { isUniqueViolation } from "@/server/lib/prisma-errors";
import { fail, succeed, type Result } from "@/server/lib/result";
import { decimalSchema } from "@/shared/decimal";
import { convert, IncompatibleUnitsError } from "@/shared/units";
import {
  findPackagingByGtin,
  findProductByDescription,
  findProductBySku,
  insertProduct,
  updateProduct,
  type PackagingWrite,
} from "./products.repository";
import {
  PRODUCT_CONFLICTS,
  type createPackagingSchema,
  type createProductBodySchema,
  type updatePackagingSchema,
  type updateProductBodySchema,
} from "./products.schemas";

type Product = NonNullable<Awaited<ReturnType<typeof findProductBySku>>>;

type TypedPackaging = z.output<typeof createPackagingSchema> | z.output<typeof updatePackagingSchema>;

// Whether another product than `sku` already holds this description or one of these GTINs. With no `sku`, any does.
async function conflictOf(input: { description?: string; gtins: string[] }, sku?: string) {
  // The database answers a uuid in lower case, whatever case the request wrote it in.
  const takenBy = (found: { sku: string } | null) => found !== null && found.sku !== sku?.toLowerCase();

  if (input.description !== undefined && takenBy(await findProductByDescription(input.description))) {
    return PRODUCT_CONFLICTS.description;
  }

  for (const gtin of input.gtins) {
    const found = await findPackagingByGtin(gtin);

    if (takenBy(found && { sku: found.productSku })) return PRODUCT_CONFLICTS.gtin;
  }

  return null;
}

/** Each content in the product's unit, or why one cannot be: another dimension, or more digits than are kept. */
function contentsIn(unit: MeasurementUnit, packagings: TypedPackaging[]): Result<string[], 400 | 409> {
  const contents: string[] = [];

  for (const packaging of packagings) {
    let content: string;

    try {
      content = convert(packaging.content, packaging.unit, unit);
    } catch (error) {
      if (error instanceof IncompatibleUnitsError)
        return fail(400, "The packaging unit does not measure this product.");
      throw error;
    }

    if (!decimalSchema.safeParse(content).success) {
      return fail(400, "The packaging content does not fit the product's unit.");
    }

    contents.push(content);
  }

  // `convert` writes a number one way only, so equal contents are equal strings.
  if (new Set(contents).size !== contents.length) return fail(409, PRODUCT_CONFLICTS.content);

  return succeed(contents);
}

const gtinsOf = (packagings: TypedPackaging[]) => packagings.flatMap(({ gtin }) => (gtin ? [gtin] : []));

// Two saves at once can both pass the checks above; the unique index then says which value was taken.
function conflictOfViolation(error: unknown) {
  if (!isUniqueViolation(error)) throw error;

  const target = String(error.meta?.target ?? "");

  if (target.includes("content")) return fail(409, PRODUCT_CONFLICTS.content);
  if (target.includes("gtin")) return fail(409, PRODUCT_CONFLICTS.gtin);

  return fail(409, PRODUCT_CONFLICTS.description);
}

export async function createProduct(
  input: z.output<typeof createProductBodySchema>,
): Promise<Result<Product, 400 | 409>> {
  const packagings = input.packagings ?? [];
  const contents = contentsIn(input.unit, packagings);

  if (!contents.ok) return contents;

  const conflict = await conflictOf({ description: input.description, gtins: gtinsOf(packagings) });

  if (conflict !== null) return fail(409, conflict);

  try {
    return succeed(
      await insertProduct({
        ...input,
        packagings: packagings.map((packaging, index) => ({
          content: contents.data[index]!,
          gtin: packaging.gtin ?? null,
        })),
      }),
    );
  } catch (error) {
    return conflictOfViolation(error);
  }
}

export async function editProduct(
  sku: string,
  { packagings, ...changes }: z.output<typeof updateProductBodySchema>,
): Promise<Result<Product, 400 | 404 | 409>> {
  const product = await findProductBySku(sku);

  if (product === null) return fail(404, "Product not found.");

  let writes: PackagingWrite[] | undefined;

  if (packagings !== undefined) {
    const stored = new Map(product.packagings.map((packaging) => [packaging.id, packaging]));

    if (packagings.some(({ id }) => id !== undefined && !stored.has(id.toLowerCase()))) {
      return fail(404, "Packaging not found.");
    }

    const contents = contentsIn(product.unit, packagings);

    if (!contents.ok) return contents;

    writes = packagings.map(({ id, gtin, isActive }, index) => ({
      ...(id === undefined ? {} : { id: id.toLowerCase() }),
      content: contents.data[index]!,
      gtin: gtin ?? null,
      isActive: isActive ?? (id === undefined || stored.get(id.toLowerCase())!.isActive),
    }));
  }

  const conflict = await conflictOf({ description: changes.description, gtins: gtinsOf(packagings ?? []) }, sku);

  if (conflict !== null) return fail(409, conflict);

  try {
    return succeed(await updateProduct(sku, writes === undefined ? changes : { ...changes, packagings: writes }));
  } catch (error) {
    return conflictOfViolation(error);
  }
}
