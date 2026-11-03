import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@prisma/client";
import * as suppliers from "@/app/v1/suppliers/route";
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

type Headers = { authorization: string } | undefined;

const listSuppliers = (headers: Headers) => inject(suppliers, { method: "GET", url: "/v1/suppliers", headers });

const postSupplier = (headers: Headers, payload: Record<string, unknown>) =>
  inject(suppliers, { method: "POST", url: "/v1/suppliers", headers, payload });

describe("GET /v1/suppliers", () => {
  it("lists the suppliers by name", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_READ]);
    const mill = await testPrisma.supplier.create({ data: { name: "Santa Clara Mill" } });
    const dairy = await testPrisma.supplier.create({ data: { name: "Boa Vista Dairy" } });

    const response = await listSuppliers(headers);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: dairy.id, name: "Boa Vista Dairy" },
      { id: mill.id, name: "Santa Clara Mill" },
    ]);
  });

  it("answers 403 without CATALOG_READ", async () => {
    const { headers } = await authenticateAs([Permission.ENTRIES_CREATE]);

    expect((await listSuppliers(headers)).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await listSuppliers(undefined)).statusCode).toBe(401);
  });
});

describe("POST /v1/suppliers", () => {
  it("registers a supplier, trimming its name", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);

    const response = await postSupplier(headers, { name: "  Santa Clara Mill  " });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: expect.any(String), name: "Santa Clara Mill" });
    expect(await testPrisma.supplier.count()).toBe(1);
  });

  it("answers 409 for a name already registered, and writes nothing", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);
    await postSupplier(headers, { name: "Santa Clara Mill" });

    const response = await postSupplier(headers, { name: "Santa Clara Mill" });

    expect(response.statusCode).toBe(409);
    expect(await testPrisma.supplier.count()).toBe(1);
  });

  it.each([
    ["a blank name", { name: "   " }],
    ["a name longer than 120 characters", { name: "x".repeat(121) }],
    ["a missing name", {}],
  ])("answers 400 for %s", async (_label, payload) => {
    const { headers } = await authenticateAs([Permission.CATALOG_CREATE]);

    expect((await postSupplier(headers, payload)).statusCode).toBe(400);
    expect(await testPrisma.supplier.count()).toBe(0);
  });

  it("answers 403 without CATALOG_CREATE", async () => {
    const { headers } = await authenticateAs([Permission.CATALOG_READ]);

    expect((await postSupplier(headers, { name: "Santa Clara Mill" })).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postSupplier(undefined, { name: "Santa Clara Mill" })).statusCode).toBe(401);
  });
});
