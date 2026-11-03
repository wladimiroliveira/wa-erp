import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@prisma/client";
import * as lossReasons from "@/app/v1/loss-reasons/route";
import * as lossReason from "@/app/v1/loss-reasons/[id]/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { authenticateAs } from "@/server/testing/authenticate";
import { inject } from "@/server/testing/inject";
import { resetDatabase, testPrisma } from "@/server/testing/database";

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

type Headers = { authorization: string } | undefined;

const MISSING_ID = "0199a1f0-0000-7000-8000-0000000000ff";

const listReasons = (headers: Headers) => inject(lossReasons, { method: "GET", url: "/v1/loss-reasons", headers });

const postReason = (headers: Headers, payload: Record<string, unknown>) =>
  inject(lossReasons, { method: "POST", url: "/v1/loss-reasons", headers, payload });

const patchReason = (headers: Headers, id: string, payload: Record<string, unknown>) =>
  inject(lossReason, { method: "PATCH", url: `/v1/loss-reasons/${id}`, params: { id }, headers, payload });

const canManage = () => authenticateAs([Permission.LOSSES_UPDATE]);

describe("GET /v1/loss-reasons", () => {
  it("lists the reasons by name, active or not, to anyone signed in", async () => {
    const { headers } = await authenticateAs([]);
    const expiry = await testPrisma.lossReason.create({ data: { name: "Expiry", description: "Past its date." } });
    const breakage = await testPrisma.lossReason.create({ data: { name: "Breakage", isActive: false } });

    const response = await listReasons(headers);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: breakage.id, name: "Breakage", description: null, isActive: false },
      { id: expiry.id, name: "Expiry", description: "Past its date.", isActive: true },
    ]);
  });

  it("answers 401 without a token", async () => {
    expect((await listReasons(undefined)).statusCode).toBe(401);
  });
});

describe("POST /v1/loss-reasons", () => {
  it("registers an active reason, trimming its name and description", async () => {
    const { headers } = await canManage();

    const response = await postReason(headers, { name: "  Expiry  ", description: "  Past its date.  " });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      name: "Expiry",
      description: "Past its date.",
      isActive: true,
    });
  });

  it("registers a reason with no description, and reads a blank one as none", async () => {
    const { headers } = await canManage();

    expect((await postReason(headers, { name: "Expiry" })).json().description).toBeNull();
    expect((await postReason(headers, { name: "Breakage", description: "   " })).json().description).toBeNull();
  });

  it("answers 409 for a name already registered, and writes nothing", async () => {
    const { headers } = await canManage();
    await postReason(headers, { name: "Expiry" });

    expect((await postReason(headers, { name: "Expiry" })).statusCode).toBe(409);
    expect(await testPrisma.lossReason.count()).toBe(1);
  });

  it.each([
    ["a blank name", { name: "   " }],
    ["a name longer than 60 characters", { name: "x".repeat(61) }],
    ["a description longer than 300 characters", { name: "Expiry", description: "x".repeat(301) }],
    ["a missing name", {}],
  ])("answers 400 for %s", async (_label, payload) => {
    const { headers } = await canManage();

    expect((await postReason(headers, payload)).statusCode).toBe(400);
  });

  it("answers 403 without LOSSES_UPDATE", async () => {
    const { headers } = await authenticateAs([Permission.LOSSES_CREATE]);

    expect((await postReason(headers, { name: "Expiry" })).statusCode).toBe(403);
  });

  it("answers 401 without a token", async () => {
    expect((await postReason(undefined, { name: "Expiry" })).statusCode).toBe(401);
  });
});

describe("PATCH /v1/loss-reasons/:id", () => {
  const createReason = () => testPrisma.lossReason.create({ data: { name: "Expiry", description: "Past its date." } });

  it("changes the name and the description", async () => {
    const { headers } = await canManage();
    const reason = await createReason();

    const response = await patchReason(headers, reason.id, { name: "Expired", description: "Out of date." });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: reason.id, name: "Expired", description: "Out of date.", isActive: true });
  });

  it("deactivates a reason and brings it back, leaving the rest as it was", async () => {
    const { headers } = await canManage();
    const reason = await createReason();

    expect((await patchReason(headers, reason.id, { isActive: false })).json()).toEqual({
      id: reason.id,
      name: "Expiry",
      description: "Past its date.",
      isActive: false,
    });
    expect((await patchReason(headers, reason.id, { isActive: true })).json().isActive).toBe(true);
  });

  it("clears the description when told so", async () => {
    const { headers } = await canManage();
    const reason = await createReason();

    expect((await patchReason(headers, reason.id, { description: null })).json().description).toBeNull();
  });

  it("answers 409 for the name of another reason", async () => {
    const { headers } = await canManage();
    const reason = await createReason();
    await testPrisma.lossReason.create({ data: { name: "Breakage" } });

    expect((await patchReason(headers, reason.id, { name: "Breakage" })).statusCode).toBe(409);
  });

  it("accepts the name the reason already has", async () => {
    const { headers } = await canManage();
    const reason = await createReason();

    expect((await patchReason(headers, reason.id, { name: "Expiry", isActive: false })).statusCode).toBe(200);
  });

  it("answers 404 for a reason that does not exist", async () => {
    const { headers } = await canManage();

    expect((await patchReason(headers, MISSING_ID, { name: "Expiry" })).statusCode).toBe(404);
  });

  it("answers 400 when there is nothing to change", async () => {
    const { headers } = await canManage();
    const reason = await createReason();

    expect((await patchReason(headers, reason.id, {})).statusCode).toBe(400);
  });

  it("answers 403 without LOSSES_UPDATE", async () => {
    const { headers } = await authenticateAs([Permission.LOSSES_CREATE]);
    const reason = await createReason();

    expect((await patchReason(headers, reason.id, { isActive: false })).statusCode).toBe(403);
  });
});
