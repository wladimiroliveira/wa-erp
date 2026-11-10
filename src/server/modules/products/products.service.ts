import type { MeasurementUnit } from "@prisma/client";
import type { z } from "zod";
import { isUniqueViolation } from "@/server/lib/prisma-errors";
import { fail, succeed, type Result } from "@/server/lib/result";
import { decimalSchema } from "@/shared/decimal";
import { convert, IncompatibleUnitsError, normalizeDecimal } from "@/shared/units";
import {
  findPackagingByGtin,
  findPackagingsWithLots,
  findProductByDescription,
  findProductBySku,
  insertProduct,
  updateProduct,
  type PackagingWrite,
} from "./products.repository";
import {
  PRODUCT_CONFLICTS,
  PRODUCT_REFUSALS,
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

/**
 * Each content in the product's unit, or why one cannot be: another dimension, more digits than are
 * kept, or a brand listed twice with one content.
 */
function contentsIn(unit: MeasurementUnit, packagings: TypedPackaging[]): Result<string[], 400 | 409> {
  const contents: string[] = [];

  for (const packaging of packagings) {
    let content: string;

    try {
      content = convert(packaging.content, packaging.unit, unit);
    } catch (error) {
      if (error instanceof IncompatibleUnitsError) return fail(400, PRODUCT_REFUSALS.unitMismatch);
      throw error;
    }

    if (!decimalSchema.safeParse(content).success) {
      return fail(400, PRODUCT_REFUSALS.contentTooFine);
    }

    contents.push(content);
  }

  // `convert` writes a number one way only, and the schema a brand, so equal pairs are equal strings.
  const pairs = new Set(contents.map((content, index) => `${packagings[index]!.brand}\u0000${content}`));

  if (pairs.size !== contents.length) return fail(409, PRODUCT_CONFLICTS.brandAndContent);

  return succeed(contents);
}

const gtinsOf = (packagings: TypedPackaging[]) => packagings.flatMap(({ gtin }) => (gtin ? [gtin] : []));

// Two saves at once can both pass the checks above; the unique index then says which value was taken.
function conflictOfViolation(error: unknown) {
  if (!isUniqueViolation(error)) throw error;

  const target = String(error.meta?.target ?? "");

  if (target.includes("content")) return fail(409, PRODUCT_CONFLICTS.brandAndContent);
  if (target.includes("gtin")) return fail(409, PRODUCT_CONFLICTS.gtin);
  if (target.includes("description")) return fail(409, PRODUCT_CONFLICTS.description);

  // A unique index this does not know of: saying "description taken" would be a lie.
  throw error;
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
          brand: packaging.brand,
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
      return fail(404, PRODUCT_REFUSALS.packagingNotFound);
    }

    const listed = new Set(packagings.flatMap(({ id }) => (id === undefined ? [] : [id.toLowerCase()])));
    const withLots = await findPackagingsWithLots(product.sku);

    if (withLots.some((id) => !listed.has(id))) return fail(409, PRODUCT_CONFLICTS.inUse);

    const contents = contentsIn(product.unit, packagings);

    if (!contents.ok) return contents;

    // The lots it came in read their packagings by this content: changing it would rewrite them.
    const changesLockedContent = packagings.some(
      ({ id }, index) =>
        id !== undefined &&
        withLots.includes(id.toLowerCase()) &&
        normalizeDecimal(stored.get(id.toLowerCase())!.content) !== contents.data[index],
    );

    if (changesLockedContent) return fail(409, PRODUCT_CONFLICTS.contentLocked);

    writes = packagings.map(({ id, brand, gtin, isActive }, index) => ({
      ...(id === undefined ? {} : { id: id.toLowerCase() }),
      brand,
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
