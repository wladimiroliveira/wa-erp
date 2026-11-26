import { z } from "zod";
import { lotExpirySchema } from "@/server/modules/stock/stock.schemas";
import { positiveDecimalSchema } from "@/shared/decimal";
import { productionBatchSourceSchema, productionItemStatusSchema, productionStatusSchema } from "@/shared/enums";
import { pageQuerySchema, pageSchema } from "@/server/lib/pagination";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { productSummarySchema } from "@/server/modules/products/products.schemas";

// A production starts in one of two ways, never mixed. Guided, it follows one root pre-weighing and
// brings the pending ones under it as items: the product, the expected yield and the inputs are the
// ones weighed. Free, the operator picks the recipe and the yield they expect, and the inputs are
// the ones the recipe plans.
const freeItemSchema = z.strictObject({ productSku: z.uuid(), quantity: positiveDecimalSchema });

export const startProductionBodySchema = z.union([
  z.strictObject({ preWeighingId: z.uuid() }),
  z.strictObject({ items: z.array(freeItemSchema).min(1) }),
]);

// Concluding an item takes what its batches add up to. Below its target it must be meant; and
// whether what is discarded of the opened packagings goes into the cost produced is asked for at
// the end, after the production happened.
export const concludeItemBodySchema = z.object({
  belowTarget: z.boolean().default(false),
  hasLeftoversInCost: z.boolean().default(true),
});

export const productionIdParamsSchema = z.object({ id: z.uuid() });

// The items about to be finished together, `?items=<id>` repeated; none means every pending one.
export const productionLeftoversQuerySchema = z.object({
  items: z
    .union([z.uuid(), z.array(z.uuid())])
    .transform((value) => [value].flat())
    .optional(),
});

export const productionItemParamsSchema = z.object({ id: z.uuid(), itemId: z.uuid() });

// How much stock there is of an intermediate against what the pending items of the production take.
export const productionSubstitutionSchema = z.object({
  product: productSummarySchema,
  needed: z.string(),
  available: z.string(),
});

// A batch the operator made now (`PRODUCED`) or found already made (`EXISTING`), and when it expires.
export const batchBodySchema = z.object({
  quantity: positiveDecimalSchema,
  // A batch sent without an expiry never expires.
  expiresAt: lotExpirySchema.default(null),
  source: productionBatchSourceSchema,
});

export const productionBatchParamsSchema = z.object({ id: z.uuid(), itemId: z.uuid(), batchId: z.uuid() });

// What went wrong with an item before it finished: why, under a loss reason, and in the operator's words.
export const damageProductionItemBodySchema = z.object({
  reasonId: z.uuid(),
  // A note left blank is the same as none.
  note: z
    .string()
    .trim()
    .max(500)
    .transform((text) => (text === "" ? null : text))
    .nullish(),
});

// A weighing of an item: how much of it to make and what was weighed of each ingredient of its recipe.
// An intermediate of the recipe is taken from stock, sent without a weighed quantity.
export const itemWeighingBodySchema = z.object({
  quantity: positiveDecimalSchema,
  items: z.array(z.object({ productSku: z.uuid(), weighedQuantity: positiveDecimalSchema.optional() })).min(1),
});

// An intermediate an item of the production lacks, added as an item of its own to be weighed and made.
export const addProductionItemBodySchema = freeItemSchema;

export const listProductionsQuerySchema = pageQuerySchema.extend({ status: productionStatusSchema.optional() });

// What a production has not finished yet is null: the produced quantity, and the costs, which are
// those of the moment the inputs leave the stock.
export const productionSchema = z.object({
  id: z.uuid(),
  status: productionStatusSchema,
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  canceledAt: z.iso.datetime().nullable(),
  items: z.array(
    z.object({
      id: z.uuid(),
      status: productionItemStatusSchema,
      finishedAt: z.iso.datetime().nullable(),
      // Whether the leftovers discarded when the item finished went into its cost; null until it finishes.
      hasLeftoversInCost: z.boolean().nullable(),
      product: productSummarySchema,
      // When the item was substituted, and when the pre-weighing that guides it was recorded.
      substitutedAt: z.iso.datetime().nullable(),
      weighedAt: z.iso.datetime().nullable(),
      preWeighingId: z.uuid().nullable(),
      expectedQuantity: z.string(),
      producedQuantity: z.string().nullable(),
      unitCost: z.string().nullable(),
      // The items of the production that make a product this one takes: it finishes after them.
      dependsOn: z.array(z.uuid()),
      // A damage took its pre-weighing away, and it cannot finish until a new one is recorded.
      awaitsWeighing: z.boolean(),
      // The batches ("levas") the item came out in, the oldest first; an expiry is a day, YYYY-MM-DD.
      batches: z.array(
        z.object({
          id: z.uuid(),
          quantity: z.string(),
          expiresAt: z.iso.date().nullable(),
          source: productionBatchSourceSchema,
          createdAt: z.iso.datetime(),
        }),
      ),
      // How many weighings the item took beyond the one that guides it.
      extraWeighings: z.number().int(),
      // Each time the item went wrong, the oldest first; the pre-weighing is the one it let go of.
      damages: z.array(
        z.object({
          id: z.uuid(),
          reason: z.object({ id: z.uuid(), name: z.string() }),
          note: z.string().nullable(),
          createdAt: z.iso.datetime(),
          preWeighingId: z.uuid().nullable(),
        }),
      ),
      inputs: z.array(
        z.object({
          product: productSummarySchema,
          quantity: z.string(),
          unitCost: z.string().nullable(),
          // What was discarded of each lot's opened packagings when the production finished.
          leftovers: z.array(z.object({ lotId: z.uuid(), quantity: z.string(), unitCost: z.string() })),
        }),
      ),
    }),
  ),
});

export const productionPageSchema = pageSchema(productionSchema);

// What finishing a production would discard of the opened packagings, as the stock stands now.
export const productionLeftoversSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.uuid(),
      leftovers: z.array(
        z.object({
          product: productSummarySchema,
          lotId: z.uuid(),
          quantity: z.string(),
          unitCost: z.string(),
          cost: z.string(),
        }),
      ),
    }),
  ),
  totalCost: z.string(),
});

// Why an item cannot be concluded yet: the stock of an intermediate does not cover what it takes, with
// the most it could make of what there is; it waits for other items of the production; or, below its
// target, what it made leaves an item that takes it short.
export const finishConflictSchema = messageSchema.extend({
  shortages: z
    .array(z.object({ itemId: z.uuid(), product: productSummarySchema, needed: z.string(), available: z.string() }))
    .optional(),
  items: z.array(z.object({ itemId: z.uuid(), maxQuantity: z.string() })).optional(),
  // The items asked to finish while another item they take is still pending.
  waitingFor: z
    .array(
      z.object({
        itemId: z.uuid(),
        product: productSummarySchema,
        waitsFor: z.array(z.object({ itemId: z.uuid(), product: productSummarySchema })),
      }),
    )
    .optional(),
  // What an intermediate concluded below its target would leave missing for the items that take it.
  missing: z.array(z.object({ product: productSummarySchema, quantity: z.string() })).optional(),
});
