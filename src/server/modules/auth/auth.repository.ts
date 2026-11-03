import { prisma } from "@/server/lib/prisma";
import type { AuthenticatedUser } from "./auth.access";
import { effectivePermissions } from "./auth.permissions";

export function findUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username }, include: { role: true } });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, include: { role: true } });
}

// The one query that crosses user and role. It answers an authentication question, which is why it
// lives here and not in the users module.
export async function loadAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
  const user = await findUserById(userId);

  if (user === null || !user.isActive) return null;

  return {
    id: user.id,
    permissions: effectivePermissions({
      rolePermissions: user.role?.permissions ?? [],
      extraPermissions: user.extraPermissions,
    }),
  };
}

export function insertRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
  return prisma.refreshToken.create({ data: input });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

export async function markRefreshTokenReplaced(id: string, replacedById: string): Promise<void> {
  await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date(), replacedById } });
}

export async function revokeRefreshToken(id: string): Promise<void> {
  await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

// The password is auth's business, per Decision 4, so its write lives here rather than in the users
// module: keeping it there would make auth import users and invert the dependency.
export async function updatePasswordHash(id: string, passwordHash: string): Promise<void> {
  await prisma.user.update({ where: { id }, data: { passwordHash } });
}

export function insertSession(input: { userId: string; tokenHash: string; expiresAt: Date }) {
  return prisma.session.create({ data: input });
}

export function findSessionByHash(tokenHash: string) {
  return prisma.session.findUnique({ where: { tokenHash } });
}

export async function revokeSession(id: string): Promise<void> {
  await prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

// Cutting a user's access means every credential they hold, on every client: the browser's session
// and the mobile app's refresh tokens. One call, so no caller revokes one kind and forgets the other.
export async function revokeAllAccess(userId: string): Promise<void> {
  await Promise.all([revokeAllRefreshTokens(userId), revokeAllSessions(userId)]);
}
