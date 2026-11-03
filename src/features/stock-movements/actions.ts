"use server";

import { Permission } from "@prisma/client";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import { stockMovementsPage } from "@/server/modules/stock/stock.service";
import { listStockMovementsQuerySchema } from "@/server/modules/stock/stock.schemas";
import type { StockMovementPage } from "@/lib/api";

export type LoadStockMovementsResult = { ok: true; data: StockMovementPage } | Failure;

/** One more page of the history, older than the cursor. The first page comes with the screen. */
export async function loadStockMovements(query: {
  productSku?: string;
  cursor?: string;
}): Promise<LoadStockMovementsResult> {
  const user = await requireUser();

  if (!can(user, Permission.ENTRIES_READ)) return fail(403, "Permission denied.");

  const parsed = listStockMovementsQuerySchema.safeParse(query);

  if (!parsed.success) return fail(400, "Invalid input.");

  return { ok: true, data: await stockMovementsPage(parsed.data) };
}
