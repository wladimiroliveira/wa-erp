"use server";

import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import {
  createPreWeighingBodySchema,
  listPreWeighingsQuerySchema,
  preWeighingPlanQuerySchema,
} from "@/server/modules/pre-weighings/pre-weighings.schemas";
import {
  listPreWeighingsPage,
  previewPreWeighing,
  recordPreWeighing,
} from "@/server/modules/pre-weighings/pre-weighings.service";
import type { CreatePreWeighingBody, PreWeighing, PreWeighingPage, PreWeighingPlan } from "@/lib/api";

/** What is to be produced: the quantity is in the unit of the product, as the server takes it. */
export interface PreWeighingTarget {
  productSku: string;
  quantity: string;
}

export type PlanResult = { ok: true; data: PreWeighingPlan } | Failure;
export type PreWeighingResult = { ok: true; data: PreWeighing } | Failure;
export type PreWeighingPageResult = { ok: true; data: PreWeighingPage } | Failure;

const LIST_PATH = "/pre-weighings";
const INVALID_INPUT = "Invalid input.";
const DENIED = "Permission denied.";

/** The plan for a target, with the lots to weigh from as the stock stands now and, within `tolerance` percent, quantities that waste less. */
export async function planPreWeighing(target: PreWeighingTarget, tolerance?: number): Promise<PlanResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_READ)) return fail(403, DENIED);

  const parsed = preWeighingPlanQuerySchema.safeParse({ ...target, tolerance });

  if (!parsed.success) return fail(400, INVALID_INPUT);

  return previewPreWeighing(parsed.data.productSku, parsed.data.quantity, parsed.data.tolerance);
}

export async function createPreWeighing(body: CreatePreWeighingBody): Promise<PreWeighingResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_CREATE)) return fail(403, DENIED);

  const parsed = createPreWeighingBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  const result = await recordPreWeighing({ ...parsed.data, createdById: user.id });

  if (!result.ok) return result;

  revalidatePath(LIST_PATH);

  return result;
}

/** The page of older pre-weighings after `cursor`, for the list to append. */
export async function loadMorePreWeighings(cursor: string): Promise<PreWeighingPageResult> {
  const user = await requireUser();

  if (!can(user, Permission.PRODUCTION_READ)) return fail(403, DENIED);

  const parsed = listPreWeighingsQuerySchema.safeParse({ cursor });

  if (!parsed.success) return fail(400, INVALID_INPUT);

  return { ok: true, data: await listPreWeighingsPage(parsed.data) };
}
