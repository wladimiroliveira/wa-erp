import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as password from "@/app/v1/sessions/me/password/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { verifyPassword } from "@/server/modules/auth/auth.password";
import { authenticateAs, TEST_PASSWORD } from "@/server/testing/authenticate";
import { resetDatabase, testPrisma } from "@/server/testing/database";
import { inject } from "@/server/testing/inject";

const NEXT = "an-even-better-password";

const changePassword = (headers: Record<string, string>, payload: unknown) =>
  inject(password, { method: "PATCH", url: "/v1/sessions/me/password", headers, payload });

// authenticateAs signs in with the same username in every case, and the login rate limiter
// keeps its counters in the process.
beforeEach(() => {
  rateLimiter.reset();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("PATCH /v1/sessions/me/password", () => {
  it("replaces the password and ends every session, including the one that asked", async () => {
    const { userId, headers } = await authenticateAs([]);

    const response = await changePassword(headers, { currentPassword: TEST_PASSWORD, newPassword: NEXT });

    const stored = await testPrisma.user.findUnique({ where: { id: userId } });
    const survivors = await testPrisma.refreshToken.count({ where: { userId, revokedAt: null } });

    expect(response.statusCode).toBe(204);
    expect(await verifyPassword(NEXT, stored!.passwordHash)).toBe(true);
    expect(survivors).toBe(0);
  });

  it("answers 401 when the current password is wrong, and keeps the old one", async () => {
    const { userId, headers } = await authenticateAs([]);

    const response = await changePassword(headers, { currentPassword: "not-my-password", newPassword: NEXT });

    const stored = await testPrisma.user.findUnique({ where: { id: userId } });

    expect(response.statusCode).toBe(401);
    expect(await verifyPassword(TEST_PASSWORD, stored!.passwordHash)).toBe(true);
  });

  it("answers 400 for a new password shorter than eight characters", async () => {
    const { headers } = await authenticateAs([]);

    const response = await changePassword(headers, { currentPassword: TEST_PASSWORD, newPassword: "short" });

    expect(response.statusCode).toBe(400);
  });
});
