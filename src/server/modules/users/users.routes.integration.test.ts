import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@prisma/client";
import * as me from "@/app/v1/sessions/me/route";
import * as users from "@/app/v1/users/route";
import * as userById from "@/app/v1/users/[id]/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { authenticateAs } from "@/server/testing/authenticate";
import { resetDatabase, testPrisma } from "@/server/testing/database";
import { inject } from "@/server/testing/inject";

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

describe("POST /v1/users", () => {
  it("creates a user and never answers the password back", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_CREATE], "admin");

    const response = await inject(users, {
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "New Person", username: "newbie", password: "a-good-password" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "New Person", username: "newbie", permissions: [] });
    expect(JSON.stringify(response.json())).not.toContain("a-good-password");
    expect(JSON.stringify(response.json())).not.toContain("passwordHash");
  });

  it("stores the password hashed", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_CREATE], "admin");

    await inject(users, {
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "New Person", username: "newbie", password: "a-good-password" },
    });

    const stored = await testPrisma.user.findUnique({ where: { username: "newbie" } });

    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
  });

  it("answers 409 for a username somebody already has", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_CREATE], "admin");

    const response = await inject(users, {
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "Impostor", username: "admin", password: "a-good-password" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 400 for a password shorter than eight characters", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_CREATE], "admin");

    const response = await inject(users, {
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { name: "New Person", username: "newbie", password: "short" },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /v1/users/:id", () => {
  it("answers the effective permission alongside the record", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_READ], "admin");
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: {
        name: "Someone",
        username: "someone",
        passwordHash: "x",
        roleId: role.id,
        extraPermissions: ["REPORTS_READ"],
      },
    });

    const response = await inject(userById, {
      method: "GET",
      url: `/v1/users/${user.id}`,
      params: { id: user.id },
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions.sort()).toEqual(["REPORTS_READ", "SALES_READ"]);
  });

  it("answers 404 for a user that does not exist", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_READ], "admin");

    const response = await inject(userById, {
      method: "GET",
      url: "/v1/users/0199a1f0-0000-7000-8000-0000000000ff",
      params: { id: "0199a1f0-0000-7000-8000-0000000000ff" },
      headers,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("PATCH /v1/users/:id", () => {
  it("assigns a role", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_UPDATE], "admin");
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x" },
    });

    const response = await inject(userById, {
      method: "PATCH",
      url: `/v1/users/${user.id}`,
      params: { id: user.id },
      headers,
      payload: { roleId: role.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toEqual(["SALES_READ"]);
  });

  it("answers 404 for a role that does not exist", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_UPDATE], "admin");
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x" },
    });

    const response = await inject(userById, {
      method: "PATCH",
      url: `/v1/users/${user.id}`,
      params: { id: user.id },
      headers,
      payload: { roleId: "0199a1f0-0000-7000-8000-0000000000ff" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("ends every session of a user it deactivates", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_UPDATE], "admin");
    const target = await authenticateAs([Permission.SALES_READ], "target");

    const response = await inject(userById, {
      method: "PATCH",
      url: `/v1/users/${target.userId}`,
      params: { id: target.userId },
      headers,
      payload: { isActive: false },
    });

    const survivors = await testPrisma.refreshToken.count({ where: { userId: target.userId, revokedAt: null } });

    expect(response.statusCode).toBe(200);
    expect(survivors).toBe(0);
    expect((await inject(me, { method: "GET", url: "/v1/sessions/me", headers: target.headers })).statusCode).toBe(401);
  });

  it("answers 409 to whoever tries to deactivate their own account, and leaves it active", async () => {
    const { headers, userId } = await authenticateAs([Permission.ACCESS_UPDATE], "admin");

    const response = await inject(userById, {
      method: "PATCH",
      url: `/v1/users/${userId}`,
      params: { id: userId },
      headers,
      payload: { isActive: false },
    });

    expect(response.statusCode).toBe(409);
    expect((await testPrisma.user.findUnique({ where: { id: userId } }))?.isActive).toBe(true);
  });

  it("answers 409 to whoever tries to drop their own ACCESS_UPDATE", async () => {
    const { headers, userId } = await authenticateAs([Permission.ACCESS_UPDATE], "admin");

    const response = await inject(userById, {
      method: "PATCH",
      url: `/v1/users/${userId}`,
      params: { id: userId },
      headers,
      payload: { extraPermissions: [Permission.ACCESS_READ] },
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 403 without ACCESS_UPDATE", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_READ], "admin");
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x" },
    });

    const response = await inject(userById, {
      method: "PATCH",
      url: `/v1/users/${user.id}`,
      params: { id: user.id },
      headers,
      payload: { isActive: false },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("GET /v1/users", () => {
  it("lists users without any password material", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_READ], "admin");

    const response = await inject(users, { method: "GET", url: "/v1/users", headers });

    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json())).not.toContain("scrypt$");
  });
});
