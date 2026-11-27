import { z } from "zod";
import { productSummarySchema } from "@/server/modules/products/products.schemas";

const MAX_MARKUP_PERCENT = 1000;

// A percentage, as the screen shows it: 35.5 means 35.5 %. Two decimals is what the column holds.
export const markupPercentSchema = z
  .string()
  .regex(/^\d{1,4}(\.\d{1,2})?$/)
  .refine((value) => Number(value) <= MAX_MARKUP_PERCENT, { message: "Must be at most 1000." });

export const saveMarkupBodySchema = z.object({ productSku: z.uuid(), markupPercent: markupPercentSchema });

export const pricingStatusSchema = z.enum(["priced", "no-markup", "no-price"]);

export const priceEntrySchema = z.object({
  price: z.string(),
  averageCost: z.string(),
  markupPercent: z.string(),
  createdAt: z.string(),
});

export const pricingRowSchema = z.object({
  product: productSummarySchema,
  status: pricingStatusSchema,
  markupPercent: z.string().nullable(),
  onHandCost: z.string().nullable(),
  currentPrice: priceEntrySchema.nullable(),
  history: z.array(priceEntrySchema),
});

export type PriceEntry = z.infer<typeof priceEntrySchema>;
export type PricingRow = z.infer<typeof pricingRowSchema>;
