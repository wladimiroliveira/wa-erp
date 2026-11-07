"use server";

import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import {
  listPreWeighingsQuerySchema,
  preWeighingPlanQuerySchema,
} from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { listPreWeighingsPage, previewPreWeighing } from "@/server/modules/pre-weighings/pre-weighings.service";
import {
  finishProductionBodySchema,
  listProductionsQuerySchema,
  productionIdParamsSchema,
  startProductionBodySchema,
} from "@/server/modules/productions/productions.schemas";
import * as productions from "@/server/modules/productions/productions.service";
import type {
  FinishProductionBody,
  PreWeighingPage,
  PreWeighingPlan,
  Production,
  ProductionPage,
  ProductionStatus,
  StartProductionBody,
} from "@/lib/api";

export type ProductionResult = { ok: true; data: Production } | Failure;
export type ProductionPageResult = { ok: true; data: ProductionPage } | Failure;
export type PlanResult = { ok: true; data: PreWeighingPlan } | Failure;
export type PreWeighingPageResult = { ok: true; data: PreWeighingPage } | Failure;

const LIST_PATH = "/productions";
// Starting and canceling change which pre-weighings are still available.
const PRE_WEIGHINGS_PATH = "/pre-weighings";
const INVALID_INPUT = "Invalid input.";
const DENIED = "Permission denied.";

const detailPath = (id: string) => `${LIST_PATH}/${id}`;

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

export async function finishProduction(id: string, body: FinishProductionBody): Promise<ProductionResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const params = productionIdParamsSchema.safeParse({ id });
  const parsed = finishProductionBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await productions.finishProduction({ ...parsed.data, id: params.data.id, createdById: user.id });

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

/** The page of pre-weighings no production uses yet, after `cursor`. */
export async function loadMoreAvailablePreWeighings(cursor: string): Promise<PreWeighingPageResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_READ)) return fail(403, DENIED);

  const parsed = listPreWeighingsQuerySchema.safeParse({ cursor, available: "true" });

  if (!parsed.success) return fail(400, INVALID_INPUT);

  return { ok: true, data: await listPreWeighingsPage(parsed.data) };
}
