"use server";

import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import { preWeighingPlanQuerySchema } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { previewPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";
import {
  damageProductionItemBodySchema,
  finishProductionBodySchema,
  listProductionsQuerySchema,
  productionIdParamsSchema,
  productionItemParamsSchema,
  productionLeftoversQuerySchema,
  productionWeighingBodySchema,
  reduceProductionItemBodySchema,
  startProductionBodySchema,
} from "@/server/modules/productions/productions.schemas";
import * as productions from "@/server/modules/productions/productions.service";
import type {
  DamageProductionItemBody,
  FinishConflict,
  FinishProductionBody,
  LeftoversPreview,
  PreWeighingPlan,
  Production,
  ProductionPage,
  ProductionStatus,
  ProductionSubstitution,
  ProductionWeighingBody,
  StartProductionBody,
} from "@/lib/api";

export type ProductionResult = { ok: true; data: Production } | Failure;
/** A 409 on finishing says what blocks it: short stock, and the most each short item could make. */
export type FinishProductionResult = ProductionResult | (Failure<409> & { details: FinishConflict });
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

export async function finishProductionItems(id: string, body: FinishProductionBody): Promise<FinishProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionIdParamsSchema.safeParse({ id });
  const parsed = finishProductionBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await productions.finishProduction({ ...parsed.data, id: params.data.id, createdById: user.id });

  if (!result.ok) return result;

  revalidateProduction(params.data.id);

  return result;
}

/** Lowers the quantity an item takes, when the stock cannot cover it. */
export async function reduceProductionItem(id: string, itemId: string, quantity: string): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionItemParamsSchema.safeParse({ id, itemId });
  const parsed = reduceProductionItemBodySchema.safeParse({ quantity });

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await productions.reduceProductionItem({
    productionId: params.data.id,
    itemId: params.data.itemId,
    quantity: parsed.data.quantity,
  });

  if (!result.ok) return result;

  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(params.data.id));

  return result;
}

export async function cancelProduction(id: string): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionIdParamsSchema.safeParse({ id });

  if (!params.success) return fail(400, INVALID_INPUT);

  const result = await productions.cancelProduction(params.data.id);

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

/** What an item produced without a pre-weighing will take, as the recipe plans it and the stock stands now. */
export async function planProductionItem(target: { productSku: string; quantity: string }): Promise<PlanResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_READ)) return fail(403, DENIED);

  const parsed = preWeighingPlanQuerySchema.safeParse(target);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  return previewPreWeighing(parsed.data.productSku, parsed.data.quantity);
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

/** A pre-weighing recorded inside the production: a new weighing for a damaged item, or the complement of a short one. */
export async function recordProductionWeighing(id: string, body: ProductionWeighingBody): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionIdParamsSchema.safeParse({ id });
  const parsed = productionWeighingBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const { itemId, parentId, ...tree } = parsed.data;
  const result = await productions.recordProductionWeighing({
    productionId: params.data.id,
    createdById: user.id,
    itemId,
    parentId,
    tree,
  });

  if (!result.ok) return result;

  revalidateProduction(params.data.id);

  return result;
}
