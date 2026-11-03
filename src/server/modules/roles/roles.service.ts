import type { Permission } from "@prisma/client";
import { fail, succeed, type Result } from "@/server/lib/result";
import { deleteRole, findRoleById, findRoleByName, insertRole, updateRole } from "./roles.repository";

type Role = Awaited<ReturnType<typeof insertRole>>;

const NAME_TAKEN = "A role with this name already exists.";
const NOT_FOUND = "Role not found.";

export async function createRole(input: { name: string; permissions: Permission[] }): Promise<Result<Role, 409>> {
  if ((await findRoleByName(input.name)) !== null) return fail(409, NAME_TAKEN);

  return succeed(await insertRole(input));
}

export async function editRole(
  id: string,
  changes: { name?: string; permissions?: Permission[] },
): Promise<Result<Role, 404 | 409>> {
  if ((await findRoleById(id)) === null) return fail(404, NOT_FOUND);

  if (changes.name !== undefined) {
    const sameName = await findRoleByName(changes.name);

    if (sameName !== null && sameName.id !== id) return fail(409, NAME_TAKEN);
  }

  return succeed(await updateRole(id, changes));
}

export async function removeRole(id: string): Promise<Result<void, 404>> {
  if ((await findRoleById(id)) === null) return fail(404, NOT_FOUND);

  await deleteRole(id);

  return succeed(undefined);
}
