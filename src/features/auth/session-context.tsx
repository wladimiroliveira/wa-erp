"use client";

import { createContext, useMemo, type ReactNode } from "react";
import type { CurrentUser, Permission } from "@/lib/api";

export interface SessionValue {
  user: CurrentUser;
  can: (permission: Permission) => boolean;
}

export const SessionContext = createContext<SessionValue | null>(null);

/**
 * Who is signed in, as the server layout read it from the cookie. Nothing is fetched here: the
 * screens only need the name to greet and the permissions to hide what the server would refuse.
 */
export function SessionProvider({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const value = useMemo<SessionValue>(
    () => ({ user, can: (permission) => user.permissions.includes(permission) }),
    [user],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}
