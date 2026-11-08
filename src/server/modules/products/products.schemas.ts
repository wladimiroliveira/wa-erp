import { z } from "zod";
import { measurementUnitSchema, productKindSchema } from "@/shared/enums";
import { positiveDecimalSchema } from "@/shared/decimal";
import { hasValidCheckDigit } from "@/shared/gtin";

// What another record shows of the product it refers to.
export const productSummarySchema = z.object({
  sku: z.uuid(),
  description: z.string(),
  unit: measurementUnitSchema,
});

// The content is in the unit of its product, whatever unit it was typed in.
export const packagingSchema = z.object({
  id: z.uuid(),
  content: z.string(),
  gtin: z.string().nullable(),
  isActive: z.boolean(),
});

export const productSchema = productSummarySchema.extend({
  kind: productKindSchema,
  isActive: z.boolean(),
  // The quantity below which the stock asks for replenishment; null when none was set.
  minimumQuantity: z.string().nullable(),
  // Ordered by content, the smallest first.
  packagings: z.array(packagingSchema),
});

// Stored in upper case, so that two spellings of one name never become two products.
export const descriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((value) => value.toLocaleUpperCase("pt-BR"));

export const gtinSchema = z
  .string()
  .regex(/^\d{8,14}$/)
  .refine(hasValidCheckDigit, { message: "The GTIN check digit does not match." });

// The unit is the one the content was typed in; the service converts it to the product's.
export const createPackagingSchema = z.object({
  content: positiveDecimalSchema,
  unit: measurementUnitSchema,
  gtin: gtinSchema.optional(),
});

// An item with an id changes that packaging; one without registers a new one.
export const updatePackagingSchema = z.object({
  id: z.uuid().optional(),
  content: positiveDecimalSchema,
  unit: measurementUnitSchema,
  gtin: gtinSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

const listsEachGtinOnce = (packagings: { gtin?: string | null }[]) => {
  const gtins = packagings.flatMap(({ gtin }) => (gtin ? [gtin] : []));

  return new Set(gtins).size === gtins.length;
};

const packagingList = <Item extends typeof createPackagingSchema | typeof updatePackagingSchema>(item: Item) =>
  z.array(item).refine(listsEachGtinOnce, { message: "A GTIN is listed more than once." });

/** The messages of the 409s a product save answers, which the form tells apart. */
export const PRODUCT_CONFLICTS = {
  description: "A product with this description already exists.",
  gtin: "A packaging with this GTIN already exists.",
  content: "The product already has a packaging with this content.",
  inUse: "A packaging with stock lots cannot be removed.",
  contentLocked: "A packaging with stock lots cannot change its content.",
} as const;

export const createProductBodySchema = z.object({
  description: descriptionSchema,
  kind: productKindSchema,
  unit: measurementUnitSchema,
  minimumQuantity: positiveDecimalSchema.optional(),
  packagings: packagingList(createPackagingSchema).optional(),
});

// Kind and unit are not here: changing them would reread every quantity and cost already recorded.
export const updateProductBodySchema = z
  .object({
    description: descriptionSchema.optional(),
    isActive: z.boolean().optional(),
    minimumQuantity: positiveDecimalSchema.nullable().optional(),
    // The whole list wanted: a stored packaging left out of it is removed. Absent, nothing changes.
    packagings: packagingList(updatePackagingSchema).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: "Nothing to update." });

export const productParamsSchema = z.object({ sku: z.uuid() });

// A parameter repeated in the query string arrives as an array, one written once as a string.
const oneOrMore = <Item extends z.ZodType>(item: Item) =>
  z.union([item, z.array(item)]).transform((value) => [value].flat() as z.output<Item>[]);

// No filter answers the whole catalog, inactive products included.
export const listProductsQuerySchema = z.object({
  // Part of the description or of the GTIN. A blank one searches nothing.
  q: z.string().trim().max(120).optional(),
  kind: oneOrMore(productKindSchema).optional(),
  unit: oneOrMore(measurementUnitSchema).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export type ProductFilters = z.output<typeof listProductsQuerySchema>;

export const listsEachProductOnce = (items: { productSku: string }[]) =>
  new Set(items.map(({ productSku }) => productSku.toLowerCase())).size === items.length;
