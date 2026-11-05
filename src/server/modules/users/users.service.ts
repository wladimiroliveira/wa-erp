import type { Permission, Role, User } from "@prisma/client";
import { fail, succeed, type Result } from "@/server/lib/result";
import { hashPassword } from "@/server/modules/auth/auth.password";
import { effectivePermissions } from "@/server/modules/auth/auth.permissions";
import {
  findUserById,
  findUserByUsername,
  revokeAllAccess,
  updatePasswordHash,
} from "@/server/modules/auth/auth.repository";
import { findRoleById } from "@/server/modules/roles/roles.repository";
import { removesOwnAccess } from "./users.lockout";
import { insertUser, listUsers as listUserRecords, updateUser } from "./users.repository";

type UserWithRole = User & { role: Role | null };

const USER_NOT_FOUND = "User not found.";
const ROLE_NOT_FOUND = "Role not found.";
const LOCKS_OUT_SELF = "You cannot deactivate yourself or remove your own ACCESS_UPDATE.";

export function presentUser(user: UserWithRole) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    roleId: user.roleId,
    extraPermissions: user.extraPermissions,
    permissions: effectivePermissions({
      rolePermissions: user.role?.permissions ?? [],
      extraPermissions: user.extraPermissions,
    }),
    isActive: user.isActive,
  };
}

export type PresentedUser = ReturnType<typeof presentUser>;

export async function listUsers(): Promise<PresentedUser[]> {
  return (await listUserRecords()).map(presentUser);
}

export async function readUser(id: string): Promise<Result<PresentedUser, 404>> {
  const user = await findUserById(id);

  if (user === null) return fail(404, USER_NOT_FOUND);

  return succeed(presentUser(user));
}

export async function createUser(input: {
  name: string;
  username: string;
  password: string;
  roleId?: string | null;
  extraPermissions?: Permission[];
}): Promise<Result<PresentedUser, 404 | 409>> {
  const { password, ...rest } = input;

  if ((await findUserByUsername(rest.username)) !== null) {
    return fail(409, "A user with this username already exists.");
  }

  if (rest.roleId != null && (await findRoleById(rest.roleId)) === null) return fail(404, ROLE_NOT_FOUND);

  return succeed(presentUser(await insertUser({ ...rest, passwordHash: await hashPassword(password) })));
}

export async function editUser(
  id: string,
  changes: { name?: string; roleId?: string | null; extraPermissions?: Permission[]; isActive?: boolean },
  actorId: string,
): Promise<Result<PresentedUser, 404 | 409>> {
  const user = await findUserById(id);

  if (user === null) return fail(404, USER_NOT_FOUND);

  const role = changes.roleId == null ? null : await findRoleById(changes.roleId);

  if (changes.roleId != null && role === null) return fail(404, ROLE_NOT_FOUND);

  const after = {
    isActive: changes.isActive ?? user.isActive,
    rolePermissions: changes.roleId === undefined ? (user.role?.permissions ?? []) : (role?.permissions ?? []),
    extraPermissions: changes.extraPermissions ?? user.extraPermissions,
  };

  if (removesOwnAccess(actorId, id, after)) return fail(409, LOCKS_OUT_SELF);

  const updated = await updateUser(id, changes);

  // Deactivating has to cut the access that is already in someone's hands, not only the next
  // login. Without this, a refresh token keeps the account alive for its full lifetime.
  if (changes.isActive === false) await revokeAllAccess(user.id);

  return succeed(presentUser(updated));
}

export async function resetPassword(id: string, newPassword: string): Promise<Result<void, 404>> {
  const user = await findUserById(id);

  if (user === null) return fail(404, USER_NOT_FOUND);

  await updatePasswordHash(user.id, await hashPassword(newPassword));
  await revokeAllAccess(user.id);

  return succeed(undefined);
}
