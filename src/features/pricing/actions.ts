"use server";

import { Permission } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import { saveMarkupBodySchema } from "@/server/modules/pricing/pricing.schemas";
import { setMarkup } from "@/server/modules/pricing/pricing.service";
import type { SaveMarkupBody } from "@/lib/api";

export async function saveMarkup(
  body: SaveMarkupBody,
): Promise<{ ok: true; data: { markupPercent: string } } | Failure> {
  const user = await requireUser();

  if (!can(user, Permission.PRICING_UPDATE)) return fail(403, "Permission denied.");

  const parsed = saveMarkupBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, "Invalid input.");

  const result = await setMarkup(user.id, parsed.data);

  if (result.ok) revalidatePath("/pricing");

  return result;
}
