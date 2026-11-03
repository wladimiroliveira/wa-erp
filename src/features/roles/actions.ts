"use server";

import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import { createRoleBodySchema, roleIdParamsSchema, updateRoleBodySchema } from "@/server/modules/roles/roles.schemas";
import { createRole as create, editRole, removeRole } from "@/server/modules/roles/roles.service";
import type { CreateRoleBody, Role, UpdateRoleBody } from "@/lib/api";

export type RoleResult = { ok: true; data: Role } | Failure;
export type DeleteRoleResult = { ok: true } | Failure;

const ROLES_PATH = "/roles";
const INVALID_INPUT = "Invalid input.";
const DENIED = "Permission denied.";

const present = ({ id, name, permissions }: Role): Role => ({ id, name, permissions });

export async function createRole(body: CreateRoleBody): Promise<RoleResult> {
  const user = await requireUser();

  if (!can(user, Permission.ACCESS_CREATE)) return fail(403, DENIED);

  const parsed = createRoleBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  const result = await create(parsed.data);

  if (!result.ok) return result;

  revalidatePath(ROLES_PATH);

  return { ok: true, data: present(result.data) };
}

export async function updateRole(id: string, body: UpdateRoleBody): Promise<RoleResult> {
  const user = await requireUser();

  if (!can(user, Permission.ACCESS_UPDATE)) return fail(403, DENIED);

  const params = roleIdParamsSchema.safeParse({ id });
  const parsed = updateRoleBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await editRole(params.data.id, parsed.data);

  if (!result.ok) return result;

  revalidatePath(ROLES_PATH);

  return { ok: true, data: present(result.data) };
}

export async function deleteRole(id: string): Promise<DeleteRoleResult> {
  const user = await requireUser();

  if (!can(user, Permission.ACCESS_UPDATE)) return fail(403, DENIED);

  const params = roleIdParamsSchema.safeParse({ id });

  if (!params.success) return fail(400, INVALID_INPUT);

  const result = await removeRole(params.data.id);

  if (!result.ok) return result;

  revalidatePath(ROLES_PATH);

  return { ok: true };
}
