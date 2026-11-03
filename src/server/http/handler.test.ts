import { Permission } from "@prisma/client";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiHandler } from "@/server/http/handler";
import { rateLimiter } from "@/server/http/rate-limit";
import { AUTHENTICATED, PUBLIC, type AuthenticatedUser } from "@/server/modules/auth/auth.access";

const USER: AuthenticatedUser = { id: "0199a1f0-0000-7000-8000-000000000001", permissions: [Permission.SALES_READ] };
const ID = "0199a1f0-0000-7000-8000-000000000002";

// The bearer check is the one piece that needs a database and a secret; here it reads the user id
// straight out of the token, so the handler can be exercised on its own.
vi.mock("@/server/auth/bearer", () => ({
  authenticateBearer: async (request: Request) => {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    return token === USER.id ? USER : null;
  },
}));

const ok = apiHandler(
  { auth: PUBLIC, tags: [], summary: "", response: { 200: z.object({ ok: z.boolean() }) } },
  async (_request, reply) => reply.send({ ok: true, secret: "never sent" } as { ok: boolean }),
);

const me = apiHandler(
  { auth: AUTHENTICATED, tags: [], summary: "", response: { 200: z.object({ id: z.string() }) } },
  async (request, reply) => reply.send({ id: request.currentUser!.id }),
);

const sales = apiHandler(
  { auth: Permission.SALES_READ, tags: [], summary: "", response: { 200: z.object({ ok: z.boolean() }) } },
  async (_request, reply) => reply.send({ ok: true }),
);

const reports = apiHandler(
  { auth: Permission.REPORTS_READ, tags: [], summary: "", response: { 200: z.object({ ok: z.boolean() }) } },
  async (_request, reply) => reply.send({ ok: true }),
);

const echo = apiHandler(
  {
    auth: PUBLIC,
    tags: [],
    summary: "",
    params: z.object({ id: z.uuid() }),
    query: z.object({
      tag: z.union([z.string(), z.array(z.string())]).optional(),
      n: z.coerce.number().optional(),
    }),
    body: z.object({ name: z.string().min(1) }),
    response: {
      201: z.object({ id: z.string(), name: z.string(), tag: z.unknown(), n: z.number().optional() }),
      204: z.void(),
    },
  },
  async (request, reply) => {
    if (request.body.name === "nothing") return reply.code(204).send();

    return reply
      .code(201)
      .send({ id: request.params.id, name: request.body.name, tag: request.query.tag, n: request.query.n });
  },
);

const limited = apiHandler(
  {
    auth: PUBLIC,
    tags: [],
    summary: "",
    body: z.object({ who: z.string() }),
    rateLimit: { max: 2, timeWindowMs: 60_000, keyGenerator: (request) => (request.body as { who: string }).who },
    response: { 200: z.object({ ok: z.boolean() }) },
  },
  async (_request, reply) => reply.send({ ok: true }),
);

const broken = apiHandler(
  { auth: PUBLIC, tags: [], summary: "", response: { 200: z.object({ ok: z.boolean() }) } },
  async () => {
    throw new Error("boom");
  },
);

type Handler = typeof ok;

const call = (
  handler: Handler,
  method: string,
  url: string,
  init: { body?: unknown; headers?: Record<string, string>; params?: Record<string, string> } = {},
) =>
  handler(
    new Request(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    }),
    { params: Promise.resolve(init.params ?? {}) },
  );

const bearer = (userId = USER.id) => ({ authorization: `Bearer ${userId}` });

beforeEach(() => {
  rateLimiter.reset();
});

describe("apiHandler", () => {
  it("keeps the declaration on the handler, for the documentation to read", () => {
    expect(sales.spec.auth).toBe(Permission.SALES_READ);
    expect(echo.spec.body).toBeDefined();
  });

  it("serializes the answer through the declared schema, dropping what it does not name", async () => {
    const response = await call(ok, "GET", "/v1/ok");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("hands the handler its params, query and body as their schemas read them", async () => {
    const response = await call(echo, "POST", `/v1/things/${ID}?tag=a&tag=b&n=3`, {
      body: { name: "x" },
      params: { id: ID },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: ID, name: "x", tag: ["a", "b"], n: 3 });
  });

  it("sends a 204 with no body", async () => {
    const response = await call(echo, "POST", `/v1/things/${ID}`, { body: { name: "nothing" }, params: { id: ID } });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it.each([
    ["params", `/v1/things/not-a-uuid`, { name: "x" }, { id: "not-a-uuid" }],
    ["query", `/v1/things/${ID}?n=abc`, { name: "x" }, { id: ID }],
    ["body", `/v1/things/${ID}`, { name: "" }, { id: ID }],
    ["a body that is not JSON", `/v1/things/${ID}`, "{oops", { id: ID }],
  ])("answers 400 for invalid %s", async (_label, url, body, params) => {
    const response = await call(echo, "POST", url, { body, params });

    expect(response.status).toBe(400);
    expect((await response.json()).statusCode).toBe(400);
  });

  it("answers 401 when an authenticated route gets no token, a bad one, or one of nobody", async () => {
    expect((await call(me, "GET", "/v1/me")).status).toBe(401);
    expect((await call(me, "GET", "/v1/me", { headers: { authorization: "Bearer nonsense" } })).status).toBe(401);
    expect((await call(me, "GET", "/v1/me", { headers: bearer(ID) })).status).toBe(401);
  });

  it("tells the handler who is calling", async () => {
    const response = await call(me, "GET", "/v1/me", { headers: bearer() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: USER.id });
  });

  it("answers 403 for a permission the user lacks, and 200 for one they hold", async () => {
    expect((await call(reports, "GET", "/v1/reports", { headers: bearer() })).status).toBe(403);
    expect((await call(sales, "GET", "/v1/sales", { headers: bearer() })).status).toBe(200);
  });

  it("checks the token before validating anything", async () => {
    expect((await call(reports, "GET", "/v1/reports?x=1", { headers: {} })).status).toBe(401);
  });

  it("answers 429 once a key's attempts run out, with when to come back", async () => {
    const codes = [];

    for (let attempt = 0; attempt < 3; attempt += 1)
      codes.push((await call(limited, "POST", "/v1/limited", { body: { who: "a" } })).status);
    const other = await call(limited, "POST", "/v1/limited", { body: { who: "b" } });
    const refused = await call(limited, "POST", "/v1/limited", { body: { who: "a" } });

    expect(codes).toEqual([200, 200, 429]);
    expect(other.status).toBe(200);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("answers 500 without leaking the error when a handler throws", async () => {
    const response = await call(broken, "GET", "/v1/broken");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Internal server error.",
    });
  });
});
