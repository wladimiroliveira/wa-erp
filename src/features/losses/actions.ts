"use server";

import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import {
  createLossBodySchema,
  createLossReasonBodySchema,
  lossReasonIdParamsSchema,
  updateLossReasonBodySchema,
} from "@/server/modules/losses/losses.schemas";
import { createLossReason as insertReason, editLossReason, recordLoss } from "@/server/modules/losses/losses.service";
import type { CreateLossBody, CreateLossReasonBody, Loss, LossReason, UpdateLossReasonBody } from "@/lib/api";

type ActionResult<T> = { ok: true; data: T } | Failure;

const INVALID_INPUT = "Invalid input.";
const PERMISSION_DENIED = "Permission denied.";

export async function createLoss(body: CreateLossBody): Promise<ActionResult<Loss>> {
  const user = await requireUser();

  if (!can(user, Permission.LOSSES_CREATE)) return fail(403, PERMISSION_DENIED);

  const parsed = createLossBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  const result = await recordLoss(parsed.data, user.id);

  if (result.ok) {
    // A loss takes from a lot: the product's position, the whole position and the history change.
    revalidatePath("/stock");
    revalidatePath("/stock/[sku]", "page");
    revalidatePath("/stock-movements");
  }

  return result;
}

export async function createLossReason(body: CreateLossReasonBody): Promise<ActionResult<LossReason>> {
  const user = await requireUser();

  if (!can(user, Permission.LOSSES_UPDATE)) return fail(403, PERMISSION_DENIED);

  const parsed = createLossReasonBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  const result = await insertReason(parsed.data);

  if (result.ok) revalidatePath("/loss-reasons");

  return result;
}

export async function updateLossReason(id: string, body: UpdateLossReasonBody): Promise<ActionResult<LossReason>> {
  const user = await requireUser();

  if (!can(user, Permission.LOSSES_UPDATE)) return fail(403, PERMISSION_DENIED);

  const params = lossReasonIdParamsSchema.safeParse({ id });
  const parsed = updateLossReasonBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await editLossReason(params.data.id, parsed.data);

  if (result.ok) revalidatePath("/loss-reasons");

  return result;
}
