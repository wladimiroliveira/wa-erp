import { MeasurementUnit, Prisma, ProductKind } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { setMinimumQuantity } from "@/server/modules/stock/stock.repository";
import { planPackagingSync } from "./packaging-sync";
import type { ProductFilters } from "./products.schemas";

const PRODUCT_FIELDS = {
  select: {
    sku: true,
    description: true,
    kind: true,
    unit: true,
    isActive: true,
    stock: { select: { minimumQuantity: true } },
    packagings: { select: { id: true, content: true, gtin: true, isActive: true }, orderBy: { content: "asc" } },
  },
} as const;

type ProductRow = Prisma.ProductGetPayload<typeof PRODUCT_FIELDS>;

function toProduct({ stock, packagings, ...product }: ProductRow) {
  return {
    ...product,
    minimumQuantity: stock?.minimumQuantity?.toString() ?? null,
    packagings: packagings.map(({ content, ...packaging }) => ({ ...packaging, content: content.toString() })),
  };
}

/** A packaging as the save wants it: with an id it is that stored one, without it is a new one. */
export type PackagingWrite = { id?: string; content: string; gtin: string | null; isActive: boolean };

const toOptionalProduct = (row: ProductRow | null) => (row === null ? null : toProduct(row));

// The search is read as plain text: the wildcards of LIKE match only themselves.
const containing = (search: string) => `%${search.replace(/[\\%_]/g, "\\$&")}%`;

// Prisma has no accent-insensitive comparison, so the search alone goes through SQL.
async function skusMatching(search: string) {
  const pattern = containing(search);
  const rows = await prisma.$queryRaw<{ sku: string }[]>`
    SELECT sku FROM products
    WHERE public.unaccent(description) ILIKE public.unaccent(${pattern})
      OR EXISTS (
        SELECT 1 FROM product_packagings AS packaging
        WHERE packaging.product_sku = products.sku AND packaging.gtin LIKE ${pattern}
      )
  `;

  return rows.map(({ sku }) => sku);
}

export async function listProducts({ q, kind, unit, status }: ProductFilters = {}) {
  const skus = q ? await skusMatching(q) : undefined;
  const where = {
    sku: skus && { in: skus },
    kind: kind && { in: kind },
    unit: unit && { in: unit },
    isActive: status && status === "ACTIVE",
  };

  return (await prisma.product.findMany({ ...PRODUCT_FIELDS, where, orderBy: { description: "asc" } })).map(toProduct);
}

export async function findProductBySku(sku: string) {
  return toOptionalProduct(await prisma.product.findUnique({ where: { sku }, ...PRODUCT_FIELDS }));
}

export async function findProductByDescription(description: string) {
  return toOptionalProduct(await prisma.product.findUnique({ where: { description }, ...PRODUCT_FIELDS }));
}

/** The packagings of the product that some stock lot came in: they can be inactivated, never removed. */
export async function findPackagingsWithLots(productSku: string): Promise<string[]> {
  const packagings = await prisma.productPackaging.findMany({
    where: { productSku, lots: { some: {} } },
    select: { id: true },
  });

  return packagings.map(({ id }) => id);
}

export function findPackagingByGtin(gtin: string) {
  return prisma.productPackaging.findUnique({ where: { gtin }, select: { id: true, productSku: true } });
}

export function insertProduct({
  minimumQuantity,
  packagings,
  ...input
}: {
  description: string;
  kind: ProductKind;
  unit: MeasurementUnit;
  minimumQuantity?: string;
  packagings: { content: string; gtin: string | null }[];
}) {
  return prisma.$transaction(async (client) => {
    const { sku } = await client.product.create({
      data: { ...input, packagings: { create: packagings } },
      select: { sku: true },
    });

    if (minimumQuantity !== undefined) await setMinimumQuantity(client, { productSku: sku, minimumQuantity });

    return toProduct(await client.product.findUniqueOrThrow({ where: { sku }, ...PRODUCT_FIELDS }));
  });
}

export function updateProduct(
  sku: string,
  {
    minimumQuantity,
    packagings,
    ...changes
  }: { description?: string; isActive?: boolean; minimumQuantity?: string | null; packagings?: PackagingWrite[] },
) {
  return prisma.$transaction(async (client) => {
    await client.product.update({ where: { sku }, data: changes, select: { sku: true } });

    if (packagings !== undefined) await syncPackagings(client, sku, packagings);

    if (minimumQuantity !== undefined) await setMinimumQuantity(client, { productSku: sku, minimumQuantity });

    return toProduct(await client.product.findUniqueOrThrow({ where: { sku }, ...PRODUCT_FIELDS }));
  });
}

// The stored packagings become the list: those left out are removed, those with an id are changed,
// the rest are registered, in the order the plan finds safe for the unique indexes.
async function syncPackagings(client: Prisma.TransactionClient, productSku: string, packagings: PackagingWrite[]) {
  const stored = await client.productPackaging.findMany({
    where: { productSku },
    select: { id: true, content: true, gtin: true },
  });
  const plan = planPackagingSync(
    stored.map(({ content, ...packaging }) => ({ ...packaging, content: content.toString() })),
    packagings,
  );

  await client.productPackaging.deleteMany({ where: { id: { in: plan.deletes } } });
  await client.productPackaging.updateMany({ where: { id: { in: plan.clearGtins } }, data: { gtin: null } });

  for (const { id, ...packaging } of plan.updates) {
    await client.productPackaging.update({ where: { id }, data: packaging });
  }

  for (const packaging of plan.creates) await client.productPackaging.create({ data: { productSku, ...packaging } });
}
