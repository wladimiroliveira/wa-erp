import { z } from "zod";
import { lotExpirySchema } from "@/server/modules/stock/stock.schemas";
import { positiveDecimalSchema } from "@/shared/decimal";
import { productionItemStatusSchema, productionStatusSchema } from "@/shared/enums";
import { pageQuerySchema, pageSchema } from "@/server/lib/pagination";
import { messageSchema } from "@/server/modules/auth/auth.schemas";
import { productSummarySchema } from "@/server/modules/products/products.schemas";
import {
  preWeighingStageBodySchema,
  preWeighingStagesSchema,
} from "@/server/modules/pre-weighings/pre-weighings.schemas";

const listsEachOnce = (ids: string[]) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length;

// A production starts in one of two ways, never mixed. Guided, it follows one root pre-weighing and
// brings the pending ones under it as items: the product, the expected yield and the inputs are the
// ones weighed. Free, the operator picks the recipe and the yield they expect, and the inputs are
// the ones the recipe plans.
const freeItemSchema = z.strictObject({ productSku: z.uuid(), quantity: positiveDecimalSchema });

export const startProductionBodySchema = z.union([
  z.strictObject({ preWeighingId: z.uuid() }),
  z.strictObject({ items: z.array(freeItemSchema).min(1) }),
]);

export const finishProductionBodySchema = z.object({
  items: z
    .array(z.object({ id: z.uuid(), producedQuantity: positiveDecimalSchema, expiresAt: lotExpirySchema }))
    .min(1)
    .refine((items) => listsEachOnce(items.map(({ id }) => id)), { message: "An item is listed more than once." }),
  // Whether what is discarded of the opened packagings goes into the cost produced. Asked for at
  // finish, after the production happened; an older client that does not say counts it.
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

export const reduceProductionItemBodySchema = z.object({ quantity: positiveDecimalSchema });

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

// A pre-weighing recorded inside a production, in one of two ways, never both: `itemId` is a pending
// item a damage left waiting for a new weighing, which the new one guides; `parentId` is the
// pre-weighing of a pending item short of an intermediate, which the complement goes under. Either
// way, each stage of what is recorded joins the production as an item of its own.
export const productionWeighingBodySchema = preWeighingStageBodySchema
  .extend({ itemId: z.uuid().optional(), parentId: z.uuid().optional(), stages: preWeighingStagesSchema() })
  .refine(({ itemId, parentId }) => (itemId === undefined) !== (parentId === undefined), {
    message: "Send exactly one of itemId and parentId.",
  });

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
      preWeighingId: z.uuid().nullable(),
      expectedQuantity: z.string(),
      producedQuantity: z.string().nullable(),
      unitCost: z.string().nullable(),
      // The items of the production that make a product this one takes: it finishes after them.
      dependsOn: z.array(z.uuid()),
      // A damage took its pre-weighing away, and it cannot finish until a new one is recorded.
      awaitsWeighing: z.boolean(),
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

// Why items cannot finish yet: the stock of an intermediate does not cover what they take, with the
// most each short item could make of what there is; or they wait for other items of the production.
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
});
