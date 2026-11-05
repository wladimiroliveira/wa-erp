"use server";

import { revalidatePath } from "next/cache";
import { Permission } from "@prisma/client";
import { can, requireUser } from "@/server/auth/current-user";
import { fail, type Failure } from "@/server/lib/result";
import {
  createUserBodySchema,
  resetPasswordBodySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from "@/server/modules/users/users.schemas";
import { createUser as create, editUser, resetPassword } from "@/server/modules/users/users.service";
import type { CreateUserBody, ResetPasswordBody, UpdateUserBody, User } from "@/lib/api";

export type UserResult = { ok: true; data: User } | Failure;
export type ResetPasswordResult = { ok: true } | Failure;

const USERS_PATH = "/users";
const INVALID_INPUT = "Invalid input.";
const DENIED = "Permission denied.";

export async function createUser(body: CreateUserBody): Promise<UserResult> {
  const user = await requireUser();

  if (!can(user, Permission.ACCESS_CREATE)) return fail(403, DENIED);

  const parsed = createUserBodySchema.safeParse(body);

  if (!parsed.success) return fail(400, INVALID_INPUT);

  const result = await create(parsed.data);

  if (!result.ok) return result;

  revalidatePath(USERS_PATH);

  return result;
}

export async function updateUser(id: string, body: UpdateUserBody): Promise<UserResult> {
  const user = await requireUser();

  if (!can(user, Permission.ACCESS_UPDATE)) return fail(403, DENIED);

  const params = userIdParamsSchema.safeParse({ id });
  const parsed = updateUserBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await editUser(params.data.id, parsed.data, user.id);

  if (!result.ok) return result;

  revalidatePath(USERS_PATH);

  return result;
}

export async function resetUserPassword(id: string, body: ResetPasswordBody): Promise<ResetPasswordResult> {
  const user = await requireUser();

  if (!can(user, Permission.ACCESS_UPDATE)) return fail(403, DENIED);

  const params = userIdParamsSchema.safeParse({ id });
  const parsed = resetPasswordBodySchema.safeParse(body);

  if (!params.success || !parsed.success) return fail(400, INVALID_INPUT);

  const result = await resetPassword(params.data.id, parsed.data.newPassword);

  if (!result.ok) return result;

  return { ok: true };
}
