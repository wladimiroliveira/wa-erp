"use server";

import { Permission } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import { createSupplierBodySchema } from "@/server/modules/suppliers/suppliers.schemas";
import { createSupplier as insert } from "@/server/modules/suppliers/suppliers.service";
import type { CreateSupplierBody, Supplier } from "@/lib/api";

export type SupplierResult = { ok: true; data: Supplier } | Failure;

export async function createSupplier(body: CreateSupplierBody): Promise<SupplierResult> {
  const user = await requireUser();

  if (!can(user, Permission.CATALOG_CREATE)) return fail(403, "Permission denied.");

  const parsed = createSupplierBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, "Invalid input.");

  const result = await insert(parsed.data);

  // The entry form offers the suppliers as well.
  if (result.ok) for (const path of ["/suppliers", "/entries"]) revalidatePath(path);

  return result;
}
