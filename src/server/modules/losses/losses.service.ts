import { toOptionalDateString } from "@/server/lib/dates";
import { fail, succeed, type Result } from "@/server/lib/result";
import {
  findLossReasonById,
  findLossReasonByName,
  insertLoss,
  insertLossReason,
  listLossReasons,
  updateLossReason,
} from "./losses.repository";
import {
  LOSS_REASON_INACTIVE,
  LOSS_REASON_MISSING,
  type CreateLossBody,
  type CreateLossReasonBody,
  type Loss,
  type LossReason,
  type UpdateLossReasonBody,
} from "./losses.schemas";

const NAME_TAKEN = "A loss reason with this name already exists.";

/** Why a loss reason cannot be written off under, wherever stock leaves as a loss. */
export const REASON_FAILURES = {
  "reason-missing": { status: 404, message: LOSS_REASON_MISSING },
  "reason-inactive": { status: 409, message: LOSS_REASON_INACTIVE },
} as const;

const LOSS_FAILURES = {
  missing: { status: 404, message: "Lot not found." },
  insufficient: { status: 409, message: "The lot does not hold that much." },
  ...REASON_FAILURES,
} as const;

export { listLossReasons };

export async function createLossReason(body: CreateLossReasonBody): Promise<Result<LossReason, 409>> {
  if ((await findLossReasonByName(body.name)) !== null) return fail(409, NAME_TAKEN);

  return succeed(await insertLossReason(body));
}

export async function editLossReason(id: string, body: UpdateLossReasonBody): Promise<Result<LossReason, 404 | 409>> {
  if ((await findLossReasonById(id)) === null) return fail(404, LOSS_REASON_MISSING);

  if (body.name !== undefined) {
    const sameName = await findLossReasonByName(body.name);

    if (sameName !== null && sameName.id !== id) return fail(409, NAME_TAKEN);
  }

  return succeed(await updateLossReason(id, body));
}

/** Records the loss of part of a lot and takes it out of stock, or says why it could not. */
export async function recordLoss(body: CreateLossBody, createdById: string): Promise<Result<Loss, 404 | 409>> {
  const recorded = await insertLoss({ ...body, createdById });

  if ("failure" in recorded) {
    const { status, message } = LOSS_FAILURES[recorded.failure];

    return fail(status, message);
  }

  const { loss, lot } = recorded;

  return succeed({
    id: loss.id,
    quantity: loss.movement.quantity.toString(),
    unitCost: lot.unitCost.toString(),
    note: loss.note,
    createdAt: loss.createdAt.toISOString(),
    reason: loss.reason,
    product: loss.lot.product,
    lot: {
      id: lot.id,
      expiresAt: toOptionalDateString(lot.expiresAt),
      quantity: lot.left.toString(),
    },
  });
}
