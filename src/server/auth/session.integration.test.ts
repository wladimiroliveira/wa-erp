import { afterAll, afterEach, describe, expect, it } from "vitest";
import { endSession, findSessionUser, startSession } from "@/server/auth/session";
import { hashPassword } from "@/server/modules/auth/auth.password";
import { revokeAllAccess } from "@/server/modules/auth/auth.repository";
import { resetDatabase, testPrisma } from "@/server/testing/database";

async function createUser(overrides: { isActive?: boolean } = {}) {
  return testPrisma.user.create({
    data: {
      name: "Test Person",
      username: "tester",
      passwordHash: await hashPassword("correct horse battery"),
      extraPermissions: ["SALES_READ"],
      isActive: overrides.isActive ?? true,
    },
  });
}

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("web session", () => {
  it("answers the user and their permissions for a token it issued", async () => {
    const user = await createUser();

    const { token } = await startSession(user.id);

    expect(await findSessionUser(token)).toEqual({ id: user.id, permissions: ["SALES_READ"] });
  });

  it("keeps only the hash of the token in the database", async () => {
    const user = await createUser();

    const { token } = await startSession(user.id);
    const stored = await testPrisma.session.findFirstOrThrow();

    expect(stored.tokenHash).not.toBe(token);
    expect(token).not.toContain(stored.tokenHash);
  });

  it("answers nobody for a token it never issued", async () => {
    expect(await findSessionUser("not-a-token")).toBeNull();
  });

  it("answers nobody once the session ended", async () => {
    const user = await createUser();
    const { token } = await startSession(user.id);

    await endSession(token);

    expect(await findSessionUser(token)).toBeNull();
  });

  it("answers nobody once the session expired", async () => {
    const user = await createUser();
    const { token } = await startSession(user.id);
    await testPrisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await findSessionUser(token)).toBeNull();
  });

  it("answers nobody once the user was deactivated", async () => {
    const user = await createUser();
    const { token } = await startSession(user.id);
    await testPrisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    expect(await findSessionUser(token)).toBeNull();
  });

  it("goes down with every refresh token when all access is revoked", async () => {
    const user = await createUser();
    const { token } = await startSession(user.id);
    await testPrisma.refreshToken.create({
      data: { userId: user.id, tokenHash: "hash", expiresAt: new Date(Date.now() + 1000) },
    });

    await revokeAllAccess(user.id);

    expect(await findSessionUser(token)).toBeNull();
    expect(await testPrisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });
});
