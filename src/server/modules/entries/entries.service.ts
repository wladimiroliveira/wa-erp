import { toOptionalDateString } from "@/server/lib/dates";
import { fail, succeed, type Failure } from "@/server/lib/result";
import { findSupplierById } from "@/server/modules/suppliers/suppliers.repository";
import { findProductBySku, insertEntry, NegativeBalancePendingError } from "./entries.repository";
import type { CreateEntryBody, Entry } from "./entries.schemas";

/** A 409 that carries `deficit` is the negative balance waiting for the entry to say how to settle it. */
export type EntryFailure = Failure<404 | 409> & { deficit?: string };

export type EntryResult = { ok: true; data: Entry } | EntryFailure;

/** Records the entry of a product into stock, or says why it could not. */
export async function recordEntry(body: CreateEntryBody, createdById: string): Promise<EntryResult> {
  const product = await findProductBySku(body.productSku);

  if (product === null) return fail(404, "Product not found.");

  if (!product.isActive) return fail(409, "Product is inactive.");

  const { supplierId } = body;

  if (supplierId !== undefined && (await findSupplierById(supplierId)) === null) {
    return fail(404, "Supplier not found.");
  }

  const recorded = await insertEntry({ ...body, createdById }).catch((error: unknown) => {
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
    },
    stock: {
      quantity: stock!.quantity.toString(),
      lastEntryCost: stock!.lastEntryCost.toString(),
      averageCost: stock!.averageCost.toString(),
    },
  });
}
