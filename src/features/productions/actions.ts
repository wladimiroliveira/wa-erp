"use server";

import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import { planReservedSchema, preWeighingPlanQuerySchema } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { previewPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";
import {
  addProductionItemBodySchema,
  batchBodySchema,
  concludeItemBodySchema,
  damageProductionItemBodySchema,
  itemWeighingBodySchema,
  listProductionsQuerySchema,
  productionBatchParamsSchema,
  productionIdParamsSchema,
  productionItemParamsSchema,
  productionLeftoversQuerySchema,
  startProductionBodySchema,
} from "@/server/modules/productions/productions.schemas";
import * as batches from "@/server/modules/productions/production-batches.service";
import * as productions from "@/server/modules/productions/productions.service";
import type {
  AddProductionItemBody,
  BatchBody,
  ConcludeItemBody,
  DamageProductionItemBody,
  FinishConflict,
  ItemWeighingBody,
  LeftoversPreview,
  PreWeighingPlan,
  Production,
  ProductionPage,
  ProductionStatus,
  ProductionSubstitution,
  StartProductionBody,
} from "@/lib/api";

export type ProductionResult = { ok: true; data: Production } | Failure;
/**
 * A 409 on concluding says what blocks it: short stock and the most the item could make, what it waits
 * for, or what an intermediate below its target would leave missing.
 */
export type ConcludeItemResult = ProductionResult | (Failure<409> & { details: FinishConflict });
export type LeftoversPreviewResult = { ok: true; data: LeftoversPreview } | Failure;
export type ProductionPageResult = { ok: true; data: ProductionPage } | Failure;
export type PlanResult = { ok: true; data: PreWeighingPlan } | Failure;
export type SubstitutionPreviewResult = { ok: true; data: ProductionSubstitution } | Failure;

const LIST_PATH = "/productions";
// Starting and canceling change which pre-weighings are still available.
const PRE_WEIGHINGS_PATH = "/pre-weighings";
const INVALID_INPUT = "Invalid input.";
const DENIED = "Permission denied.";

const detailPath = (id: string) => `${LIST_PATH}/${id}`;

// What a production changes shows in the lists, in its own page and in the pre-weighings it uses.
function revalidateProduction(id: string): void {
  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(id));
  revalidatePath(PRE_WEIGHINGS_PATH);
}

export async function startProduction(body: StartProductionBody): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const parsed = startProductionBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  const result = await productions.startProduction({ ...parsed.data, createdById: user.id });

  if (!result.ok) return result;

  revalidatePath(LIST_PATH);
  revalidatePath(PRE_WEIGHINGS_PATH);

  return result;
}

/**
 * What finishing these items of the production would discard of the opened packagings, as the
 * stock stands now. With no items, every pending one.
 */
export async function previewLeftovers(id: string, itemIds?: string[]): Promise<LeftoversPreviewResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_READ)) return fail(403, DENIED);

  const params = productionIdParamsSchema.safeParse({ id });
  const query = productionLeftoversQuerySchema.safeParse({ items: itemIds });

  if (!params.success || !query.success) return fail(400, INVALID_INPUT);

  return productions.previewLeftovers(params.data.id, query.data.items);
}

/** Concludes an item with what its batches add up to: its inputs leave the stock and its batches come in. */
export async function concludeItem(id: string, itemId: string, body: ConcludeItemBody): Promise<ConcludeItemResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionItemParamsSchema.safeParse({ id, itemId });
  const parsed = concludeItemBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await batches.concludeItem({
    productionId: params.data.id,
    itemId: params.data.itemId,
    ...parsed.data,
    createdById: user.id,
  });

  if (!result.ok) return result;

  revalidateProduction(params.data.id);

  return result;
}

export async function cancelProduction(id: string): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionIdParamsSchema.safeParse({ id });

  if (!params.success) return fail(400, INVALID_INPUT);

  const result = await batches.cancelProduction({ id: params.data.id, createdById: user.id });

  if (!result.ok) return result;

  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(params.data.id));
  revalidatePath(PRE_WEIGHINGS_PATH);

  return result;
}

/** The page of older productions after `cursor`, under the same status the list is showing. */
export async function loadMoreProductions(
  status: ProductionStatus | undefined,
  cursor: string,
): Promise<ProductionPageResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_READ)) return fail(403, DENIED);

  const parsed = listProductionsQuerySchema.safeParse({ status, cursor });

  if (!parsed.success) return fail(400, INVALID_INPUT);

  return { ok: true, data: await productions.listProductionsPage(parsed.data) };
}

/**
 * What an item produced without a pre-weighing will take, as the recipe plans it and the stock stands now,
 * less what the items before it in the same production take of each intermediate (`reserved`).
 */
export async function planProductionItem(
  target: { productSku: string; quantity: string },
  produce?: Record<string, string>,
  reserved?: Record<string, string>,
): Promise<PlanResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_READ)) return fail(403, DENIED);

  const parsed = preWeighingPlanQuerySchema.safeParse({
    ...target,
    produce: produce && Object.entries(produce).map(([sku, quantity]) => `${sku}:${quantity}`),
  });
  const parsedReserved = planReservedSchema.optional().safeParse(reserved);

  if (!parsed.success || !parsedReserved.success) return fail(400, INVALID_INPUT);

  return previewPreWeighing(
    parsed.data.productSku,
    parsed.data.quantity,
    undefined,
    parsed.data.produce,
    parsedReserved.data && new Map(Object.entries(parsedReserved.data)),
  );
}

/** An item went wrong before it finished: what it took leaves the stock as losses under the reason. */
export async function damageProductionItem(
  id: string,
  itemId: string,
  body: DamageProductionItemBody,
): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionItemParamsSchema.safeParse({ id, itemId });
  const parsed = damageProductionItemBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await productions.damageProductionItem({
    productionId: params.data.id,
    itemId: params.data.itemId,
    ...parsed.data,
    createdById: user.id,
  });

  if (!result.ok) return result;

  revalidateProduction(params.data.id);

  return result;
}

/** The stock of an intermediate against what the pending items take of it, before it is used instead of made. */
export async function previewSubstitution(id: string, itemId: string): Promise<SubstitutionPreviewResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_READ)) return fail(403, DENIED);

  const params = productionItemParamsSchema.safeParse({ id, itemId });

  if (!params.success) return fail(400, INVALID_INPUT);

  return productions.previewSubstitution({ productionId: params.data.id, itemId: params.data.itemId });
}

/** Resolves an intermediate with stock of the same product instead of making it. */
export async function substituteProductionItem(id: string, itemId: string): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionItemParamsSchema.safeParse({ id, itemId });

  if (!params.success) return fail(400, INVALID_INPUT);

  const result = await productions.substituteProductionItem({
    productionId: params.data.id,
    itemId: params.data.itemId,
  });

  if (!result.ok) return result;

  revalidateProduction(params.data.id);

  return result;
}

/** One more batch ("leva") of an item: what came out of it, when it expires and whether it was made now or found. */
export async function recordBatch(id: string, itemId: string, body: BatchBody): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionItemParamsSchema.safeParse({ id, itemId });
  const parsed = batchBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await batches.recordBatch({
    productionId: params.data.id,
    itemId: params.data.itemId,
    ...parsed.data,
    createdById: user.id,
  });

  if (!result.ok) return result;

  revalidateProduction(params.data.id);

  return result;
}

/** Takes a batch back while its item is pending. */
export async function removeBatch(id: string, itemId: string, batchId: string): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionBatchParamsSchema.safeParse({ id, itemId, batchId });

  if (!params.success) return fail(400, INVALID_INPUT);

  const result = await batches.removeBatch({
    productionId: params.data.id,
    itemId: params.data.itemId,
    batchId: params.data.batchId,
  });

  if (!result.ok) return result;

  revalidateProduction(params.data.id);

  return result;
}

/** A weighing of an item: how much of it to make and what was weighed of each ingredient. */
export async function weighItem(id: string, itemId: string, body: ItemWeighingBody): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionItemParamsSchema.safeParse({ id, itemId });
  const parsed = itemWeighingBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await batches.weighItem({
    productionId: params.data.id,
    itemId: params.data.itemId,
    ...parsed.data,
    createdById: user.id,
  });

  if (!result.ok) return result;

  revalidateProduction(params.data.id);

  return result;
}

/** What a shortage of an intermediate asks for: one more item of it, to be weighed and made. */
export async function addShortageItem(id: string, body: AddProductionItemBody): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionIdParamsSchema.safeParse({ id });
  const parsed = addProductionItemBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await batches.addShortageItem({ productionId: params.data.id, ...parsed.data });

  if (!result.ok) return result;

  revalidateProduction(params.data.id);

  return result;
}
