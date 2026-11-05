import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, getCurrentUser, requireUser } from "@/server/auth/current-user";
import { REQUEST_PATH_HEADER, SESSION_COOKIE } from "@/server/auth/proxy-contract";

const USER = { id: "0199a1f0-0000-7000-8000-000000000001", permissions: ["SALES_READ" as const] };

const cookieJar = new Map<string, string>();
const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined) }),
  headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  findSessionUser: async (token: string) => (token === "valid" ? USER : null),
}));

beforeEach(() => {
  cookieJar.clear();
  requestHeaders.clear();
});

describe("getCurrentUser", () => {
  it("answers nobody without the session cookie", async () => {
    expect(await getCurrentUser()).toBeNull();
  });

  it("answers nobody for a cookie the session store does not know", async () => {
    cookieJar.set(SESSION_COOKIE, "stale");

    expect(await getCurrentUser()).toBeNull();
  });

  it("answers the user the cookie belongs to", async () => {
    cookieJar.set(SESSION_COOKIE, "valid");

    expect(await getCurrentUser()).toEqual(USER);
  });
});

describe("requireUser", () => {
  it("sends an anonymous visitor to the sign-in screen", async () => {
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("keeps the way back when a stale cookie is found out", async () => {
    cookieJar.set(SESSION_COOKIE, "stale");
    requestHeaders.set(REQUEST_PATH_HEADER, "/stock/sku-1?tab=2");

    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT /login?from=%2Fstock%2Fsku-1%3Ftab%3D2");
  });

  it("hands back the signed-in user", async () => {
    cookieJar.set(SESSION_COOKIE, "valid");

    expect(await requireUser()).toEqual(USER);
  });
});

describe("can", () => {
  it("answers whether the user holds the permission", () => {
    expect(can(USER, "SALES_READ")).toBe(true);
    expect(can(USER, "REPORTS_READ")).toBe(false);
  });
});
