import { loadEnv } from "@/server/lib/env";
import { signAccessToken } from "./auth.jwt";
import { hashPassword, verifyPassword } from "./auth.password";
import type { AuthenticatedUser } from "./auth.access";
import { createRefreshToken, hashRefreshToken, refreshTokenExpiration } from "./auth.refresh-token";
import {
  findRefreshTokenByHash,
  findUserById,
  findUserByUsername,
  insertRefreshToken,
  markRefreshTokenReplaced,
  revokeAllAccess,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  updatePasswordHash,
} from "./auth.repository";

export type SessionTokens = { accessToken: string; refreshToken: string };

async function issueTokens(userId: string): Promise<SessionTokens & { refreshTokenId: string }> {
  const env = loadEnv();
  const { token, tokenHash } = createRefreshToken();

  const stored = await insertRefreshToken({
    userId,
    tokenHash,
    expiresAt: refreshTokenExpiration(new Date(), env.REFRESH_TOKEN_TTL_DAYS),
  });

  const accessToken = await signAccessToken(
    { secret: env.JWT_SECRET, ttlMinutes: env.ACCESS_TOKEN_TTL_MINUTES },
    userId,
  );

  return { accessToken, refreshToken: token, refreshTokenId: stored.id };
}

/** How many sign-in attempts one address may spend on one username per minute: enough to slow a password sweep. */
export const SIGN_IN_RATE_LIMIT = { max: 5, timeWindowMs: 60_000 };

/** The user these credentials belong to, or null. The web and the API both start from here. */
export async function authenticate(input: { username: string; password: string }): Promise<{ id: string } | null> {
  const user = await findUserByUsername(input.username);

  // The password is verified even when the user does not exist, so that a missing username and a
  // wrong password take the same time to answer.
  const digest = user?.passwordHash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA";
  const matches = await verifyPassword(input.password, digest);

  if (user === null || !user.isActive || !matches) return null;

  return { id: user.id };
}

export async function login(input: { username: string; password: string }): Promise<SessionTokens | null> {
  const user = await authenticate(input);

  if (user === null) return null;

  const { accessToken, refreshToken } = await issueTokens(user.id);

  return { accessToken, refreshToken };
}

export async function refreshSession(refreshToken: string): Promise<SessionTokens | null> {
  const stored = await findRefreshTokenByHash(hashRefreshToken(refreshToken));

  if (stored === null) return null;

  // A token that was already rotated coming back means two parties hold the same credential. The
  // safe reading is theft, so the whole chain goes down.
  if (stored.revokedAt !== null) {
    await revokeAllRefreshTokens(stored.userId);
    return null;
  }

  if (stored.expiresAt.getTime() <= Date.now()) return null;

  const issued = await issueTokens(stored.userId);

  await markRefreshTokenReplaced(stored.id, issued.refreshTokenId);

  return { accessToken: issued.accessToken, refreshToken: issued.refreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  const stored = await findRefreshTokenByHash(hashRefreshToken(refreshToken));

  if (stored === null || stored.revokedAt !== null) return;

  await revokeRefreshToken(stored.id);
}

export const INVALID_CREDENTIALS = { message: "Invalid credentials." };

export type CurrentUser = {
  id: string;
  name: string;
  username: string;
  roleId: string | null;
  permissions: AuthenticatedUser["permissions"];
};

/** The signed-in user as the screens and the mobile app read them: identity plus effective permissions. */
export async function currentUserOf(current: AuthenticatedUser): Promise<CurrentUser> {
  const user = await findUserById(current.id);

  return {
    id: current.id,
    name: user!.name,
    username: user!.username,
    roleId: user!.roleId,
    permissions: current.permissions,
  };
}

/** Replaces the password once the current one matches. False means it did not. */
export async function changeOwnPassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<boolean> {
  const user = await findUserById(userId);
  const matches = await verifyPassword(input.currentPassword, user!.passwordHash);

  if (!matches) return false;

  await updatePasswordHash(user!.id, await hashPassword(input.newPassword));

  // Every session goes, this one included, on every client. A credential stolen before the change
  // would otherwise outlive it, and the change would have solved nothing.
  await revokeAllAccess(user!.id);

  return true;
}
