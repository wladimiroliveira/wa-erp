import { z } from "zod";
import { positiveDecimalSchema } from "@/shared/decimal";
import { pageQuerySchema, pageSchema } from "@/server/lib/pagination";
import { listsEachProductOnce, productSummarySchema } from "@/server/modules/products/products.schemas";

// The quantity is how much of the product is to be produced, in the unit of the product.
const targetSchema = { productSku: z.uuid(), quantity: positiveDecimalSchema };

// How much more than asked for, in percent, a production may be to leave less behind of what cannot be kept.
export const preWeighingPlanQuerySchema = z.object({
  ...targetSchema,
  // `?tolerance=` left empty means the default, not zero.
  tolerance: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().int().min(0).max(100).default(20),
  ),
});

export const createPreWeighingBodySchema = z.object({
  ...targetSchema,
  items: z
    .array(z.object({ productSku: z.uuid(), weighedQuantity: positiveDecimalSchema }))
    .min(1)
    .refine(listsEachProductOnce, { message: "An item is listed more than once." }),
});

export const preWeighingIdParamsSchema = z.object({ id: z.uuid() });

// A pre-weighing is available while no production is using it.
export const listPreWeighingsQuerySchema = pageQuerySchema.extend({
  available: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

// A quantity to produce and what it leaves of the opened packagings, the money lost in reais, to the cent.
const wasteSuggestionSchema = z.object({
  quantity: z.string(),
  loss: z.string(),
  leftovers: z.array(z.object({ product: productSummarySchema, leftover: z.string(), loss: z.string().nullable() })),
});

export const preWeighingPlanSchema = z.object({
  product: productSummarySchema,
  quantity: z.string(),
  items: z.array(
    z.object({
      product: productSummarySchema,
      plannedQuantity: z.string(),
      // Where to weigh it from, as the stock stands now, and what the stock does not have.
      lots: z.array(z.object({ id: z.uuid(), expiresAt: z.iso.date().nullable(), quantity: z.string() })),
      shortfall: z.string(),
    }),
  ),
  // What the opened packagings of the ingredients that cannot be kept would leave behind; null when
  // the recipe takes none of them.
  waste: z
    .object({
      tolerance: z.number().int(),
      requested: wasteSuggestionSchema,
      // Quantities up to `tolerance` percent more that lose less, the lowest loss first.
      alternatives: z.array(wasteSuggestionSchema),
      // Ingredients left out of the count: no packaging is known for them, or no average cost.
      unpackaged: z.array(productSummarySchema),
      uncosted: z.array(productSummarySchema),
    })
    .nullable(),
});

export const preWeighingSchema = z.object({
  id: z.uuid(),
  product: productSummarySchema,
  quantity: z.string(),
  createdAt: z.iso.datetime(),
  items: z.array(z.object({ product: productSummarySchema, plannedQuantity: z.string(), weighedQuantity: z.string() })),
});

export const preWeighingPageSchema = pageSchema(preWeighingSchema);
