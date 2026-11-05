import { Permission } from "@prisma/client";
import { effectivePermissions, hasPermission, type PermissionSources } from "@/server/modules/auth/auth.permissions";

/**
 * Whether an edit would take from its own author the power to manage access: deactivating their
 * account, or leaving them without ACCESS_UPDATE. Nobody else could then undo it from the
 * interface, and in a small installation that author is often the only administrator.
 */
export function removesOwnAccess(
  actorId: string,
  targetId: string,
  after: PermissionSources & { isActive: boolean },
): boolean {
  if (actorId !== targetId) return false;

  return !after.isActive || !hasPermission(effectivePermissions(after), Permission.ACCESS_UPDATE);
}
