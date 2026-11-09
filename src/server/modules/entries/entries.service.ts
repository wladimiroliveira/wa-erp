import { toOptionalDateString } from "@/server/lib/dates";
import { fail, succeed, type Failure, type Result } from "@/server/lib/result";
import { findSupplierById } from "@/server/modules/suppliers/suppliers.repository";
import { decimalSchema } from "@/shared/decimal";
import { packagedQuantity, packageUnitCost } from "@/shared/packaging-entry";
import { findProductBySku, insertEntry, NegativeBalancePendingError } from "./entries.repository";
import type { CreateEntryBody, Entry } from "./entries.schemas";

/** A 409 that carries `deficit` is the negative balance waiting for the entry to say how to settle it. */
export type EntryFailure = Failure<400 | 404 | 409> & { deficit?: string };

export type EntryResult = { ok: true; data: Entry } | EntryFailure;

type Product = NonNullable<Awaited<ReturnType<typeof findProductBySku>>>;

type InStockUnit = {
  quantity: string;
  unitCost: string;
  packagingId?: string;
  packageCount?: number;
  packagePrice?: string;
};

/** The entry in the product's own unit: a packaged one is turned into the quantity and cost it amounts to. */
function inStockUnit(body: CreateEntryBody, product: Product): Result<InStockUnit, 400 | 404 | 409> {
  if (!("packagingId" in body)) return succeed({ quantity: body.quantity, unitCost: body.unitCost });

  const packaging = product.packagings.find(({ id }) => id === body.packagingId.toLowerCase());

  if (packaging === undefined) return fail(404, "Packaging not found.");

  if (!packaging.isActive) return fail(409, "Packaging is inactive.");

  const quantity = packagedQuantity(packaging.content, body.packageCount);

  if (!decimalSchema.safeParse(quantity).success) return fail(400, "The quantity does not fit the stock.");

  return succeed({
    quantity,
    unitCost: packageUnitCost(body.packagePrice, packaging.content),
    packagingId: packaging.id,
    packageCount: body.packageCount,
    packagePrice: body.packagePrice,
  });
}

/** Records the entry of a product into stock, or says why it could not. */
export async function recordEntry(body: CreateEntryBody, createdById: string): Promise<EntryResult> {
  const product = await findProductBySku(body.productSku);

  if (product === null) return fail(404, "Product not found.");

  if (!product.isActive) return fail(409, "Product is inactive.");

  const { supplierId } = body;

  if (supplierId !== undefined && (await findSupplierById(supplierId)) === null) {
    return fail(404, "Supplier not found.");
  }

  const converted = inStockUnit(body, product);

  if (!converted.ok) return converted;

  const { productSku, expiresAt, deficit } = body;
  const recorded = await insertEntry({
    productSku,
    expiresAt,
    ...(supplierId === undefined ? {} : { supplierId }),
    ...(deficit === undefined ? {} : { deficit }),
    ...converted.data,
    createdById,
  }).catch((error: unknown) => {
    if (error instanceof NegativeBalancePendingError) return error;

    throw error;
  });

  if (recorded instanceof NegativeBalancePendingError) {
    return { ...fail(409, recorded.message), deficit: recorded.deficit.toString() };
  }

  const { movement, lot, stock } = recorded;

  return succeed({
    id: movement.id,
    type: movement.type,
    quantity: movement.quantity.toString(),
    unitCost: movement.unitCost.toString(),
    createdAt: movement.createdAt.toISOString(),
    product: { sku: product.sku, description: product.description, unit: product.unit },
    lot: {
      id: lot.id,
      expiresAt: toOptionalDateString(lot.expiresAt),
      supplier: lot.supplier,
      quantity: lot.quantity.toString(),
      packaging:
        lot.packaging === null || lot.packageCount === null || lot.packagePrice === null
          ? null
          : {
              id: lot.packaging.id,
              content: lot.packaging.content.toString(),
              count: lot.packageCount,
              price: lot.packagePrice.toString(),
            },
    },
    stock: {
      quantity: stock!.quantity.toString(),
      lastEntryCost: stock!.lastEntryCost.toString(),
      averageCost: stock!.averageCost.toString(),
    },
  });
}
