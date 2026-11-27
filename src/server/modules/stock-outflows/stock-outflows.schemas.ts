import { z } from "zod";
import { moneySchema, positiveDecimalSchema } from "@/shared/decimal";
import { stockOutflowKindSchema } from "@/shared/enums";
import { pageQuerySchema, pageSchema } from "@/server/lib/pagination";
import { optionalText } from "@/shared/text";
import { productSummarySchema } from "@/server/modules/products/products.schemas";

const common = {
  productSku: z.uuid(),
  quantity: positiveDecimalSchema,
  note: optionalText(300).optional(),
};

export const createOutflowBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SALE"), ...common, unitPrice: moneySchema }),
  z.object({ kind: z.literal("DONATION"), ...common }),
]);

export const outflowSchema = z.object({
  id: z.uuid(),
  kind: stockOutflowKindSchema,
  product: productSummarySchema,
  quantity: z.string(),
  listPrice: z.string().nullable(),
  unitPrice: z.string().nullable(),
  cost: z.string(),
  revenue: z.string().nullable(),
  profit: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.object({ id: z.uuid(), name: z.string() }),
});

export type CreateOutflowBody = z.output<typeof createOutflowBodySchema>;
export type Outflow = z.input<typeof outflowSchema>;

const PERIOD_ORDER_MESSAGE = "from must not be after to";

const periodShape = { from: z.iso.date(), to: z.iso.date(), productSku: z.uuid().optional() };

// A period never ends before it starts.
const startsNotAfterEnd = <Query extends z.ZodType<{ from: string; to: string }>>(query: Query) =>
  query.refine((period) => period.from <= period.to, { message: PERIOD_ORDER_MESSAGE, path: ["to"] });

export const outflowPeriodQuerySchema = startsNotAfterEnd(z.object(periodShape));

export const listOutflowsQuerySchema = startsNotAfterEnd(pageQuerySchema.extend(periodShape));

// What a sale or donation of a product starts from: its list price, what its lots cost and how much they hold.
export const outflowQuoteSchema = z.object({
  listPrice: z.string().nullable(),
  onHandCost: z.string().nullable(),
  available: z.string(),
});

export const outflowPageSchema = pageSchema(outflowSchema);

export const outflowSummarySchema = z.object({
  revenue: z.string(),
  saleCost: z.string(),
  profit: z.string(),
  donated: z.string(),
  result: z.string(),
  saleCount: z.number().int(),
  donationCount: z.number().int(),
});

export type OutflowPeriodQuery = z.output<typeof outflowPeriodQuerySchema>;
export type ListOutflowsQuery = z.output<typeof listOutflowsQuerySchema>;
export type OutflowPage = z.input<typeof outflowPageSchema>;
export type OutflowQuote = z.input<typeof outflowQuoteSchema>;
export type OutflowSummary = z.input<typeof outflowSummarySchema>;
