import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Permission } from "@prisma/client";
import type { AuthenticatedUser } from "@/server/modules/auth/auth.access";
import { hasPermission } from "@/server/modules/auth/auth.permissions";
import { findSessionUser, SESSION_COOKIE } from "./session";

/**
 * Who the request's cookie belongs to. Cached per request, so the layout, the page and every
 * action of one render read the session once.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (token === undefined) return null;

  return findSessionUser(token);
});

/** The signed-in user, or the sign-in screen. The proxy already sends away whoever has no cookie; this catches a cookie that no longer opens a session. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();

  if (user === null) redirect("/login");

  return user;
}

export const can = (user: AuthenticatedUser, permission: Permission): boolean =>
  hasPermission(user.permissions, permission);
