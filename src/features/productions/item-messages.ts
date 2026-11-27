import type { Failure } from "@/server/lib/result";
import { LOSS_REASON_INACTIVE, LOSS_REASON_MISSING } from "@/server/modules/losses/losses.schemas";

/** What each refusal of an item action means to the operator, for damage and substitution alike. */
export const ITEM_MESSAGES = {
  404: "Esse item não existe mais.",
  409: "O item mudou enquanto isso. A página foi atualizada.",
};

// A damage can also be refused for its reason, under the same statuses as a changed or missing item:
// only the server's message tells them apart.
const REASON_MESSAGES: Record<string, string> = {
  [LOSS_REASON_INACTIVE]: "Esse motivo de perda foi desativado. A página foi atualizada.",
  [LOSS_REASON_MISSING]: "Esse motivo de perda não existe mais. A página foi atualizada.",
};

/** What a refused damage means to the operator, when the refusal was for its loss reason. */
export const reasonMessageOf = (failure: Failure): string | undefined => REASON_MESSAGES[failure.message];
