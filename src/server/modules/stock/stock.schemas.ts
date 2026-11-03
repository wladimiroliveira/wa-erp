import { z } from "zod";
import { stockMovementTypeSchema } from "@/shared/enums";
import { localToday } from "@/shared/dates";
import { pageQuerySchema, pageSchema } from "@/server/lib/pagination";
import { productSummarySchema } from "@/server/modules/products/products.schemas";
import { supplierSchema } from "@/server/modules/suppliers/suppliers.schemas";
import { LotStatus, StockStatus } from "@/shared/stock-status";

// The day a lot expires on, or null for one that never does. It is asked for, never assumed: a lot
// with no expiry is said so rather than implied by a field left out.
export const lotExpirySchema = z.iso
  .date()
  .refine((date) => date >= localToday(), { message: "The lot has already expired." })
  .nullable();

export const listStockMovementsQuerySchema = pageQuerySchema.extend({ productSku: z.uuid().optional() });

export const stockMovementSchema = z.object({
  id: z.uuid(),
  type: stockMovementTypeSchema,
  quantity: z.string(),
  unitCost: z.string(),
  createdAt: z.iso.datetime(),
  product: productSummarySchema,
  // Null for a movement that moved no lot: what was taken beyond the lots, or a balance adjustment.
  lot: z.object({ id: z.uuid(), expiresAt: z.iso.date().nullable(), supplier: supplierSchema.nullable() }).nullable(),
  createdBy: z.object({ id: z.uuid(), name: z.string() }),
});

export const stockMovementPageSchema = pageSchema(stockMovementSchema);

const stockItemSchema = z.object({
  product: productSummarySchema,
  quantity: z.string(),
  minimumQuantity: z.string().nullable(),
  lastEntryCost: z.string().nullable(),
  averageCost: z.string().nullable(),
  value: z.string(),
  lotCount: z.number().int(),
  nextExpiresAt: z.iso.date().nullable(),
  status: z.enum(StockStatus),
});

export const stockPositionSchema = z.object({ items: z.array(stockItemSchema), totalValue: z.string() });

export const productStockParamsSchema = z.object({ sku: z.uuid() });

// Lots with nothing left are history, so they come only when asked for.
export const productStockQuerySchema = z.object({ depleted: z.enum(["true", "false"]).default("false") });

export const productStockSchema = stockItemSchema.extend({
  lots: z.array(
    z.object({
      id: z.uuid(),
      expiresAt: z.iso.date().nullable(),
      supplier: supplierSchema.nullable(),
      initialQuantity: z.string(),
      quantity: z.string(),
      unitCost: z.string(),
      value: z.string(),
      createdAt: z.iso.datetime(),
      status: z.enum(LotStatus),
    }),
  ),
});

export type ListStockMovementsQuery = z.output<typeof listStockMovementsQuerySchema>;
