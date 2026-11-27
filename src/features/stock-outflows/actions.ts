"use server";

import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";
import { z } from "zod";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, succeed, type Failure } from "@/server/lib/result";
import {
  createOutflowBodySchema,
  listOutflowsQuerySchema,
  outflowPeriodQuerySchema,
} from "@/server/modules/stock-outflows/stock-outflows.schemas";
import {
  listOutflows,
  outflowQuote,
  recordOutflow,
  summariseOutflows,
} from "@/server/modules/stock-outflows/stock-outflows.service";
import type {
  CreateOutflowBody,
  ListOutflowsQuery,
  Outflow,
  OutflowPage,
  OutflowQuote,
  OutflowSummary,
} from "@/lib/api";

type ActionResult<T> = { ok: true; data: T } | Failure;

const INVALID_INPUT = "Invalid input.";
const PERMISSION_DENIED = "Permission denied.";

export async function registerOutflow(body: CreateOutflowBody): Promise<ActionResult<Outflow>> {
  const user = await requireUser();

  if (!can(user, Permission.SALES_CREATE)) return fail(403, PERMISSION_DENIED);

  const parsed = createOutflowBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  const result = await recordOutflow(parsed.data, user.id);

  // The outflow took from the lots: the list, the summary, the position and the history change.
  if (result.ok) {
    revalidatePath("/stock-outflows");
    revalidatePath("/stock");
    revalidatePath("/stock/[sku]", "page");
    revalidatePath("/stock-movements");
  }

  return result;
}

/** One more page of the outflows of a period, older than the cursor. The first page comes with the screen. */
export async function loadOutflows(query: ListOutflowsQuery): Promise<ActionResult<OutflowPage>> {
  const user = await requireUser();

  if (!can(user, Permission.SALES_READ)) return fail(403, PERMISSION_DENIED);

  const parsed = listOutflowsQuerySchema.safeParse(query);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  return succeed(await listOutflows(parsed.data));
}

export async function loadOutflowSummary(query: {
  from: string;
  to: string;
  productSku?: string;
}): Promise<ActionResult<OutflowSummary>> {
  const user = await requireUser();

  if (!can(user, Permission.SALES_READ)) return fail(403, PERMISSION_DENIED);

  const parsed = outflowPeriodQuerySchema.safeParse(query);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  return succeed(await summariseOutflows(parsed.data));
}

export async function quoteOutflow(productSku: string): Promise<ActionResult<OutflowQuote>> {
  const user = await requireUser();

  if (!can(user, Permission.SALES_READ)) return fail(403, PERMISSION_DENIED);

  const parsed = z.uuid().safeParse(productSku);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  return succeed(await outflowQuote(parsed.data));
}
