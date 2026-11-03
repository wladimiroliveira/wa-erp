import { z } from "zod";
import { positiveDecimalSchema } from "@/shared/decimal";
import { productSummarySchema } from "@/server/modules/products/products.schemas";

// Text that is optional: one left blank is the same as none.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((text) => (text === "" ? null : text));

const reasonName = z.string().trim().min(1).max(60);

export const lossReasonSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
});

export const createLossReasonBodySchema = z.object({
  name: reasonName,
  description: optionalText(300).optional(),
});

export const updateLossReasonBodySchema = z
  .object({
    name: reasonName.optional(),
    description: optionalText(300).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: "Nothing to update." });

export const lossReasonIdParamsSchema = z.object({ id: z.uuid() });

export const createLossBodySchema = z.object({
  lotId: z.uuid(),
  reasonId: z.uuid(),
  quantity: positiveDecimalSchema,
  note: optionalText(300).optional(),
});

export const lossSchema = z.object({
  id: z.uuid(),
  quantity: z.string(),
  unitCost: z.string(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  reason: z.object({ id: z.uuid(), name: z.string() }),
  product: productSummarySchema,
  // The lot as the loss left it: `quantity` is what it still holds.
  lot: z.object({ id: z.uuid(), expiresAt: z.iso.date().nullable(), quantity: z.string() }),
});

export type LossReason = z.input<typeof lossReasonSchema>;
export type CreateLossReasonBody = z.output<typeof createLossReasonBodySchema>;
export type UpdateLossReasonBody = z.output<typeof updateLossReasonBodySchema>;
export type CreateLossBody = z.output<typeof createLossBodySchema>;
export type Loss = z.input<typeof lossSchema>;
