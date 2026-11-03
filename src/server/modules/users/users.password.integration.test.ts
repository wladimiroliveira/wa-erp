import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@prisma/client";
import { verifyPassword } from "@/server/modules/auth/auth.password";
import * as me from "@/app/v1/sessions/me/route";
import * as password from "@/app/v1/users/[id]/password/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { authenticateAs } from "@/server/testing/authenticate";
import { resetDatabase, testPrisma } from "@/server/testing/database";
import { inject } from "@/server/testing/inject";

const NEXT = "an-even-better-password";

// authenticateAs signs in on every case, and the login rate limiter keeps its counters in the
// process: a budget shared between cases would make one test fail because of another.
beforeEach(() => {
  rateLimiter.reset();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("PATCH /v1/users/:id/password", () => {
  it("resets another person's password without asking for the old one", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_UPDATE], "admin");
    const target = await authenticateAs([], "target");

    const response = await inject(password, {
      method: "PATCH",
      url: `/v1/users/${target.userId}/password`,
      params: { id: target.userId },
      headers,
      payload: { newPassword: NEXT },
    });

    const stored = await testPrisma.user.findUnique({ where: { id: target.userId } });

    expect(response.statusCode).toBe(204);
    expect(await verifyPassword(NEXT, stored!.passwordHash)).toBe(true);
    expect((await inject(me, { method: "GET", url: "/v1/sessions/me", headers: target.headers })).statusCode).toBe(200);
    expect(await testPrisma.refreshToken.count({ where: { userId: target.userId, revokedAt: null } })).toBe(0);
  });

  it("answers 403 without ACCESS_UPDATE", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_READ], "admin");
    const target = await authenticateAs([], "target");

    const response = await inject(password, {
      method: "PATCH",
      url: `/v1/users/${target.userId}/password`,
      params: { id: target.userId },
      headers,
      payload: { newPassword: NEXT },
    });

    expect(response.statusCode).toBe(403);
  });
});
