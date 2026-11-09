import { z } from "zod";
import { stockMovementTypeSchema } from "@/shared/enums";
import { decimalSchema, moneySchema, positiveDecimalSchema } from "@/shared/decimal";
import { productSummarySchema } from "@/server/modules/products/products.schemas";
import { lotExpirySchema } from "@/server/modules/stock/stock.schemas";
import { supplierSchema } from "@/server/modules/suppliers/suppliers.schemas";

// How an entry settles a balance that went negative: bring it to zero first, so the whole entry is
// in stock, or let the entry pay what is owed and keep only what is left.
export const DeficitSettlement = { ZERO: "ZERO", DISCOUNT: "DISCOUNT" } as const;

export type DeficitSettlement = (typeof DeficitSettlement)[keyof typeof DeficitSettlement];

/** The most packagings one entry takes. */
export const MAX_PACKAGE_COUNT = 99_999;

const entryBase = {
  productSku: z.uuid(),
  expiresAt: lotExpirySchema,
  supplierId: z.uuid().optional(),
  deficit: z.enum(DeficitSettlement).optional(),
};

// Received in the product's own unit: the quantity and the cost of one unit, as typed.
export const looseEntryBodySchema = z.strictObject({
  ...entryBase,
  quantity: positiveDecimalSchema,
  unitCost: decimalSchema,
});

// Received in packagings: how many, and what one costs. The service turns it into the product's unit.
export const packagedEntryBodySchema = z.strictObject({
  ...entryBase,
  packagingId: z.uuid(),
  // A bound well above any invoice, and below what a misread barcode would type into the count.
  packageCount: z.number().int().min(1).max(MAX_PACKAGE_COUNT),
  packagePrice: moneySchema,
});

// Strict on both sides, so a body that mixes the two shapes matches neither.
export const createEntryBodySchema = z.union([looseEntryBodySchema, packagedEntryBodySchema]);

export const entrySchema = z.object({
  id: z.uuid(),
  type: stockMovementTypeSchema,
  quantity: z.string(),
  unitCost: z.string(),
  createdAt: z.iso.datetime(),
  product: productSummarySchema,
  lot: z.object({
    id: z.uuid(),
    expiresAt: z.iso.date().nullable(),
    supplier: supplierSchema.nullable(),
    quantity: z.string(),
    // The packaging the lot came in, with its content in the product's unit and the price of one; null for a loose entry.
    packaging: z.object({ id: z.uuid(), content: z.string(), count: z.number().int(), price: z.string() }).nullable(),
  }),
  stock: z.object({ quantity: z.string(), lastEntryCost: z.string(), averageCost: z.string() }),
});

// A 409 that carries `deficit` is the negative balance waiting for the entry to say how to settle it.
export const entryConflictSchema = z.object({ message: z.string(), deficit: z.string().optional() });

export type CreateEntryBody = z.output<typeof createEntryBodySchema>;
export type Entry = z.input<typeof entrySchema>;
