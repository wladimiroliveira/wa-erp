"use server";

import type { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import {
  deleteTableLayout,
  saveTableLayout as writeTableLayout,
} from "@/server/modules/table-layouts/table-layouts.repository";
import { tableKeyParamsSchema, tableLayoutBodySchema } from "@/server/modules/table-layouts/table-layouts.schemas";

type Saved = { ok: true } | Failure;

// Each user arranges only their own tables, so every write goes under the user signed in. Nothing
// is revalidated: the screen already holds the layout it asked to save, and the next session reads
// it from the server with the rest of the layouts.
export async function saveTableLayout(tableKey: string, body: z.input<typeof tableLayoutBodySchema>): Promise<Saved> {
  const user = await requireUser();
  const key = tableKeyParamsSchema.safeParse({ tableKey });
  const layout = tableLayoutBodySchema.safeParse(body);

  if (!key.success || !layout.success) return fail(400, "Invalid input.");

  await writeTableLayout(user.id, key.data.tableKey, layout.data);

  return { ok: true };
}

export async function resetTableLayout(tableKey: string): Promise<Saved> {
  const user = await requireUser();
  const key = tableKeyParamsSchema.safeParse({ tableKey });

  if (!key.success) return fail(400, "Invalid input.");

  await deleteTableLayout(user.id, key.data.tableKey);

  return { ok: true };
}
