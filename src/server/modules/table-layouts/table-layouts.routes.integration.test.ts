import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as tableLayouts from "@/app/v1/sessions/me/table-layouts/route";
import * as tableLayout from "@/app/v1/sessions/me/table-layouts/[tableKey]/route";
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

const URL = "/v1/sessions/me/table-layouts";

const listLayouts = (headers: Headers) => inject(tableLayouts, { method: "GET", url: URL, headers });

const putLayout = (headers: Headers, tableKey: string, payload: Record<string, unknown>) =>
  inject(tableLayout, { method: "PUT", url: `${URL}/${tableKey}`, params: { tableKey }, headers, payload });

const deleteLayout = (headers: Headers, tableKey: string) =>
  inject(tableLayout, { method: "DELETE", url: `${URL}/${tableKey}`, params: { tableKey }, headers });

const LAYOUT = { order: ["description", "kind", "unit"], widths: { description: 320, kind: 120 } };

describe("GET /v1/sessions/me/table-layouts", () => {
  it("lists only the layouts of whoever asks, by table", async () => {
    const me = await authenticateAs([]);
    const other = await authenticateAs([], "other");
    await putLayout(me.headers, "suppliers", { order: ["name"], widths: {} });
    await putLayout(me.headers, "products", LAYOUT);
    await putLayout(other.headers, "products", { order: ["unit"], widths: {} });

    const response = await listLayouts(me.headers);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { tableKey: "products", ...LAYOUT },
      { tableKey: "suppliers", order: ["name"], widths: {} },
    ]);
  });

  it("answers an empty list to someone who never changed a table", async () => {
    const { headers } = await authenticateAs([]);

    expect((await listLayouts(headers)).json()).toEqual([]);
  });

  it("answers 401 without a token", async () => {
    expect((await listLayouts(undefined)).statusCode).toBe(401);
  });
});

describe("PUT /v1/sessions/me/table-layouts/:tableKey", () => {
  it("records the layout of a table, to anyone signed in", async () => {
    const { headers } = await authenticateAs([]);

    const response = await putLayout(headers, "products", LAYOUT);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tableKey: "products", ...LAYOUT });
  });

  it("replaces the layout already recorded instead of keeping a second one", async () => {
    const { headers } = await authenticateAs([]);
    await putLayout(headers, "products", LAYOUT);

    const response = await putLayout(headers, "products", { order: ["unit", "kind"], widths: { unit: 90 } });

    expect(response.json()).toEqual({ tableKey: "products", order: ["unit", "kind"], widths: { unit: 90 } });
    expect(await testPrisma.tableLayout.count()).toBe(1);
  });

  it.each([
    ["a table key with capitals", "Products", LAYOUT],
    ["a table key longer than 60 characters", "x".repeat(61), LAYOUT],
    ["a repeated column", "products", { order: ["kind", "kind"], widths: {} }],
    ["a column key with spaces", "products", { order: ["a b"], widths: {} }],
    ["more than 40 columns", "products", { order: Array.from({ length: 41 }, (_, i) => `c${i}`), widths: {} }],
    ["a width under 40 pixels", "products", { order: [], widths: { kind: 39 } }],
    ["a width over 2000 pixels", "products", { order: [], widths: { kind: 2001 } }],
    ["a fractional width", "products", { order: [], widths: { kind: 100.5 } }],
    ["a missing order", "products", { widths: {} }],
    ["missing widths", "products", { order: [] }],
  ])("answers 400 for %s", async (_label, tableKey, payload) => {
    const { headers } = await authenticateAs([]);

    expect((await putLayout(headers, tableKey, payload)).statusCode).toBe(400);
  });

  it("answers 401 without a token", async () => {
    expect((await putLayout(undefined, "products", LAYOUT)).statusCode).toBe(401);
  });
});

describe("DELETE /v1/sessions/me/table-layouts/:tableKey", () => {
  it("forgets the layout of that table only, so it comes back as designed", async () => {
    const { headers } = await authenticateAs([]);
    await putLayout(headers, "products", LAYOUT);
    await putLayout(headers, "suppliers", { order: ["name"], widths: {} });

    const response = await deleteLayout(headers, "products");

    expect(response.statusCode).toBe(204);
    expect((await listLayouts(headers)).json()).toEqual([{ tableKey: "suppliers", order: ["name"], widths: {} }]);
  });

  it("answers 204 for a table that had no layout", async () => {
    const { headers } = await authenticateAs([]);

    expect((await deleteLayout(headers, "products")).statusCode).toBe(204);
  });

  it("leaves the layout of someone else alone", async () => {
    const me = await authenticateAs([]);
    const other = await authenticateAs([], "other");
    await putLayout(other.headers, "products", LAYOUT);

    await deleteLayout(me.headers, "products");

    expect((await listLayouts(other.headers)).json()).toEqual([{ tableKey: "products", ...LAYOUT }]);
  });

  it("answers 401 without a token", async () => {
    expect((await deleteLayout(undefined, "products")).statusCode).toBe(401);
  });
});
