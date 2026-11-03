import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as health from "@/app/v1/health/route";
import * as me from "@/app/v1/sessions/me/route";
import * as refresh from "@/app/v1/sessions/refresh/route";
import * as signin from "@/app/v1/sessions/signin/route";
import * as signout from "@/app/v1/sessions/signout/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { hashPassword } from "@/server/modules/auth/auth.password";
import { resetDatabase, testPrisma } from "@/server/testing/database";
import { inject } from "@/server/testing/inject";

const PASSWORD = "correct horse battery";

async function createUser() {
  const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });

  return testPrisma.user.create({
    data: {
      name: "Test Person",
      username: "tester",
      passwordHash: await hashPassword(PASSWORD),
      roleId: role.id,
      extraPermissions: ["REPORTS_READ"],
    },
  });
}

async function loginAs(username = "tester", password = PASSWORD) {
  const response = await inject(signin, {
    method: "POST",
    url: "/v1/sessions/signin",
    payload: { username, password },
  });

  return { statusCode: response.statusCode, body: response.json() };
}

const refreshWith = (refreshToken: string) =>
  inject(refresh, { method: "POST", url: "/v1/sessions/refresh", payload: { refreshToken } });

// The login rate limiter keeps its counters in the process, and a budget shared between cases
// would make one test fail because of another.
beforeEach(() => {
  rateLimiter.reset();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("POST /v1/sessions/signin", () => {
  it("answers 200 and a token pair for the right credentials", async () => {
    await createUser();

    const { statusCode, body } = await loginAs();

    expect(statusCode).toBe(200);
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
  });

  it("answers 401 with the same message for a wrong password and for an unknown username", async () => {
    await createUser();

    const wrongPassword = await loginAs("tester", "wrong");
    const unknownUser = await loginAs("ghost", PASSWORD);

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });

  it("answers 400 when the body does not carry a username", async () => {
    const response = await inject(signin, {
      method: "POST",
      url: "/v1/sessions/signin",
      payload: { password: PASSWORD },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /v1/sessions/refresh", () => {
  it("answers a new pair", async () => {
    await createUser();
    const { body } = await loginAs();

    const response = await refreshWith(body.refreshToken);

    expect(response.statusCode).toBe(200);
    expect(response.json().refreshToken).not.toBe(body.refreshToken);
  });

  it("answers 401 for a token that was already rotated", async () => {
    await createUser();
    const { body } = await loginAs();
    await refreshWith(body.refreshToken);

    const response = await refreshWith(body.refreshToken);

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /v1/sessions/signout", () => {
  it("revokes the refresh token presented", async () => {
    await createUser();
    const { body } = await loginAs();

    const ended = await inject(signout, {
      method: "POST",
      url: "/v1/sessions/signout",
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { refreshToken: body.refreshToken },
    });
    const refreshed = await refreshWith(body.refreshToken);

    expect(ended.statusCode).toBe(204);
    expect(refreshed.statusCode).toBe(401);
  });

  it("answers 401 without an access token", async () => {
    const response = await inject(signout, {
      method: "POST",
      url: "/v1/sessions/signout",
      payload: { refreshToken: "whatever" },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("GET /v1/sessions/me", () => {
  it("answers the current user and the permission the role and the extras add up to", async () => {
    const user = await createUser();
    const { body } = await loginAs();

    const response = await inject(me, {
      method: "GET",
      url: "/v1/sessions/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: user.id,
      name: "Test Person",
      username: "tester",
      roleId: user.roleId,
      permissions: ["SALES_READ", "REPORTS_READ"],
    });
  });

  it("answers 401 once the user is deactivated, on the next request", async () => {
    const user = await createUser();
    const { body } = await loginAs();

    await testPrisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const response = await inject(me, {
      method: "GET",
      url: "/v1/sessions/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("GET /v1/health", () => {
  it("answers without a token", async () => {
    expect((await inject(health, { method: "GET", url: "/v1/health" })).statusCode).toBe(200);
  });
});
