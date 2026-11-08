import { z } from "zod";
import { productSummarySchema } from "@/server/modules/products/products.schemas";

const MAX_MARKUP_PERCENT = 1000;

// A percentage, as the screen shows it: 35.5 means 35.5 %. Two decimals is what the column holds.
export const markupPercentSchema = z
  .string()
  .regex(/^\d{1,4}(\.\d{1,2})?$/)
  .refine((value) => Number(value) <= MAX_MARKUP_PERCENT, { message: "Must be at most 1000." });

export const saveMarkupBodySchema = z.object({ productSku: z.uuid(), markupPercent: markupPercentSchema });

export const pricingStatusSchema = z.enum(["priced", "no-markup", "incomplete-cost"]);

export const pricingRowSchema = z.object({
  product: productSummarySchema,
  yieldQuantity: z.string(),
  status: pricingStatusSchema,
  costPerUnit: z.string().nullable(),
  markupPercent: z.string().nullable(),
  pricePerUnit: z.string().nullable(),
  ingredients: z.array(
    z.object({
      product: productSummarySchema,
      quantity: z.string(),
      averageCost: z.string().nullable(),
      subtotal: z.string().nullable(),
    }),
  ),
});

export type PricingRow = z.infer<typeof pricingRowSchema>;
