import { z } from "zod";
import { decimalSchema, positiveDecimalSchema } from "@/shared/decimal";
import { pageQuerySchema, pageSchema } from "@/server/lib/pagination";
import { listsEachProductOnce, productSummarySchema } from "@/server/modules/products/products.schemas";

// The quantity is how much of the product is to be produced, in the unit of the product.
const targetSchema = { productSku: z.uuid(), quantity: positiveDecimalSchema };

// `<sku>:<quantity>` pairs saying how much to produce of an intermediate, a quantity of zero meaning
// to take it from stock. A product listed twice is ambiguous, so it is refused.
const produceSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value, context) => {
    const produce = new Map<string, string>();

    for (const entry of [value].flat()) {
      const [sku, quantity, ...rest] = entry.split(":");
      const parsedSku = z.uuid().safeParse(sku);
      const parsedQuantity = decimalSchema.safeParse(quantity);

      if (rest.length > 0 || !parsedSku.success || !parsedQuantity.success) {
        context.addIssue({ code: "custom", message: "Expected <sku>:<quantity>." });

        return z.NEVER;
      }

      const key = parsedSku.data.toLowerCase();

      if (produce.has(key)) {
        context.addIssue({ code: "custom", message: "A product is listed more than once." });

        return z.NEVER;
      }

      produce.set(key, parsedQuantity.data);
    }

    return produce;
  })
  .optional();

// How much more than asked for, in percent, a production may be to leave less behind of what cannot be kept.
export const preWeighingPlanQuerySchema = z.object({
  ...targetSchema,
  // `?tolerance=` left empty means the default, not zero.
  tolerance: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().int().min(0).max(100).default(20),
  ),
  produce: produceSchema,
});

// A pre-weighing of a product and, under it, those of the intermediates it takes. A line of a manufactured
// ingredient carries no weighed quantity: it is taken from stock, or made in the stage that names it.
// The two types only spell out the recursion for the compiler; read the body's type off the schema.
type StageInput = {
  productSku: string;
  quantity: string;
  items: { productSku: string; weighedQuantity?: string }[];
  stages?: StageInput[];
};
type StageOutput = Required<StageInput> & { stages: StageOutput[] };

export const preWeighingStageBodySchema = z
  .object({
    ...targetSchema,
    items: z
      .array(z.object({ productSku: z.uuid(), weighedQuantity: positiveDecimalSchema.optional() }))
      .refine(listsEachProductOnce, { message: "An item is listed more than once." }),
    get stages(): z.ZodDefault<z.ZodArray<z.ZodType<StageOutput, StageInput>>> {
      return stagesSchema();
    },
  })
  .meta({ id: "PreWeighingStageBody" });

function stagesSchema() {
  return z.array(preWeighingStageBodySchema).default([]);
}

// With `parentId`, the pre-weighing is recorded under one that exists already: the complement of a shortage.
// Its stages are a list of its own: sharing the stage body's would leave the document an unnamed schema
// for the recursion.
export const createPreWeighingBodySchema = preWeighingStageBodySchema.extend({
  parentId: z.uuid().optional(),
  stages: stagesSchema(),
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

export const preWeighingPlanSchema = z
  .object({
    product: productSummarySchema,
    quantity: z.string(),
    items: z.array(
      z.object({
        product: productSummarySchema,
        plannedQuantity: z.string(),
        // Where to weigh it from, as the stock stands now, and what the stock does not have.
        lots: z.array(z.object({ id: z.uuid(), expiresAt: z.iso.date().nullable(), quantity: z.string() })),
        shortfall: z.string(),
        // Set for an ingredient that is itself manufactured: how much of it the plan needs, how much
        // the stock has, how much is to be produced and the plan of that production (null when none is).
        manufactured: z
          .object({
            needed: z.string(),
            inStock: z.string(),
            toProduce: z.string(),
            get stage() {
              return preWeighingPlanSchema.nullable();
            },
          })
          .nullable(),
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
  })
  .meta({ id: "PreWeighingPlan" });

export const preWeighingSchema = z.object({
  id: z.uuid(),
  product: productSummarySchema,
  quantity: z.string(),
  createdAt: z.iso.datetime(),
  // No production is using it: one can start from it, and it can be deleted.
  isAvailable: z.boolean(),
  // The pre-weighing whose product takes this one's, and the ones of the intermediates this one takes.
  parent: z.object({ id: z.uuid(), product: productSummarySchema }).nullable(),
  children: z.array(z.object({ id: z.uuid(), product: productSummarySchema, quantity: z.string() })),
  // Null on the line of a manufactured ingredient: it is taken from stock, not weighed.
  items: z.array(
    z.object({ product: productSummarySchema, plannedQuantity: z.string(), weighedQuantity: z.string().nullable() }),
  ),
});

export const preWeighingPageSchema = pageSchema(preWeighingSchema);
