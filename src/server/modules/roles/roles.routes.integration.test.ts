import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@prisma/client";
import * as roles from "@/app/v1/roles/route";
import * as roleById from "@/app/v1/roles/[id]/route";
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

describe("POST /v1/roles", () => {
  it("creates a role with the permissions it was given", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_CREATE]);

    const response = await inject(roles, {
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: [Permission.SALES_READ, Permission.SALES_CREATE] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "Seller", permissions: ["SALES_READ", "SALES_CREATE"] });
  });

  it("answers 403 without ACCESS_CREATE", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_READ]);

    const response = await inject(roles, {
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: [] },
    });

    expect(response.statusCode).toBe(403);
  });

  it("answers 409 for a name another role already has", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_CREATE]);
    await testPrisma.role.create({ data: { name: "Seller", permissions: [] } });

    const response = await inject(roles, {
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: [] },
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 400 for a permission that is not in the enum", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_CREATE]);

    const response = await inject(roles, {
      method: "POST",
      url: "/v1/roles",
      headers,
      payload: { name: "Seller", permissions: ["SALES_DESTROY"] },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /v1/roles", () => {
  it("lists the roles in alphabetical order", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_READ]);
    await testPrisma.role.createMany({
      data: [
        { name: "Stocker", permissions: [] },
        { name: "Seller", permissions: [] },
      ],
    });

    const response = await inject(roles, { method: "GET", url: "/v1/roles", headers });

    expect(response.json().map((role: { name: string }) => role.name)).toEqual(["Seller", "Stocker"]);
  });

  it("answers 401 without a token", async () => {
    expect((await inject(roles, { method: "GET", url: "/v1/roles" })).statusCode).toBe(401);
  });
});

describe("PATCH /v1/roles/:id", () => {
  it("replaces the permission package", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_UPDATE]);
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });

    const response = await inject(roleById, {
      method: "PATCH",
      url: `/v1/roles/${role.id}`,
      params: { id: role.id },
      headers,
      payload: { permissions: [Permission.REPORTS_READ] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toEqual(["REPORTS_READ"]);
  });

  it("answers 404 for a role that does not exist", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_UPDATE]);

    const response = await inject(roleById, {
      method: "PATCH",
      url: "/v1/roles/0199a1f0-0000-7000-8000-0000000000ff",
      params: { id: "0199a1f0-0000-7000-8000-0000000000ff" },
      headers,
      payload: { permissions: [] },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /v1/roles/:id", () => {
  it("removes the role and leaves its users without inheritance", async () => {
    const { headers } = await authenticateAs([Permission.ACCESS_UPDATE]);
    const role = await testPrisma.role.create({ data: { name: "Seller", permissions: ["SALES_READ"] } });
    const user = await testPrisma.user.create({
      data: { name: "Someone", username: "someone", passwordHash: "x", roleId: role.id },
    });

    const response = await inject(roleById, {
      method: "DELETE",
      url: `/v1/roles/${role.id}`,
      params: { id: role.id },
      headers,
    });

    expect(response.statusCode).toBe(204);
    expect((await testPrisma.user.findUnique({ where: { id: user.id } }))?.roleId).toBeNull();
  });
});
