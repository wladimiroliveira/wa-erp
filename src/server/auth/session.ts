import { loadEnv } from "@/server/lib/env";
import type { AuthenticatedUser } from "@/server/modules/auth/auth.access";
import {
  findSessionByHash,
  insertSession,
  loadAuthenticatedUser,
  revokeSession,
} from "@/server/modules/auth/auth.repository";
import { createOpaqueToken, expirationFrom, hashOpaqueToken } from "./opaque-token";

/** The one cookie of the web: it carries the session token and nothing else. */
export const SESSION_COOKIE = "wa_session";

export type StartedSession = { token: string; expiresAt: Date };

export async function startSession(userId: string): Promise<StartedSession> {
  const { token, tokenHash } = createOpaqueToken();
  const expiresAt = expirationFrom(new Date(), loadEnv().REFRESH_TOKEN_TTL_DAYS);

  await insertSession({ userId, tokenHash, expiresAt });

  return { token, expiresAt };
}

/** Who the session token belongs to, or null for a token that is unknown, ended, expired or of nobody. */
export async function findSessionUser(token: string): Promise<AuthenticatedUser | null> {
  const stored = await findSessionByHash(hashOpaqueToken(token));

  if (stored === null || stored.revokedAt !== null || stored.expiresAt.getTime() <= Date.now()) return null;

  return loadAuthenticatedUser(stored.userId);
}

export async function endSession(token: string): Promise<void> {
  const stored = await findSessionByHash(hashOpaqueToken(token));

  if (stored === null || stored.revokedAt !== null) return;

  await revokeSession(stored.id);
}

/** The cookie as the browser must keep it: out of reach of scripts, sent only to this site, over HTTPS in production. */
export function sessionCookie(session: StartedSession) {
  return {
    name: SESSION_COOKIE,
    value: session.token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  };
}
