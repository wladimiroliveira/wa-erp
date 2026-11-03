import type { ReactNode } from "react";
import { can, requireUser } from "@/server/auth/current-user";
import { ForbiddenPage } from "@/features/auth/ForbiddenPage";
import type { Permission } from "@/lib/api";

/**
 * Renders 403 rather than redirecting to the sign-in screen. The server tells "I don't know who
 * you are" apart from "I do, and you may not"; collapsing both into a login prompt would throw
 * that distinction away and confuse the person who is, in fact, signed in.
 *
 * A server component: the screen under it is never rendered, let alone its data read, unless the
 * permission is there.
 */
export async function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const user = await requireUser();

  if (!can(user, permission)) return <ForbiddenPage />;

  return children;
}
