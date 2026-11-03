"use server";

import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";
import { can, requireUser } from "@/server/auth/current-user";
import { fail } from "@/server/lib/result";
import { createEntryBodySchema } from "@/server/modules/entries/entries.schemas";
import { recordEntry, type EntryFailure } from "@/server/modules/entries/entries.service";
import type { CreateEntryBody, Entry } from "@/lib/api";

/** The 409 that carries `deficit` is the negative balance waiting to be settled, not a refusal. */
export type CreateEntryResult = { ok: true; data: Entry } | EntryFailure | ReturnType<typeof fail<400 | 403>>;

/** What an entry changes: the position of the product, the whole position, and the history. */
function revalidateStock(): void {
  revalidatePath("/stock");
  revalidatePath("/stock/[sku]", "page");
  revalidatePath("/stock-movements");
}

export async function createEntry(body: CreateEntryBody): Promise<CreateEntryResult> {
  const user = await requireUser();

  if (!can(user, Permission.ENTRIES_CREATE)) return fail(403, "Permission denied.");

  const parsed = createEntryBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, "Invalid input.");

  const result = await recordEntry(parsed.data, user.id);

  if (result.ok) revalidateStock();

  return result;
}
