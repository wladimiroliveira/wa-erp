import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeOwnPassword, signIn, signOut } from "@/features/auth/actions";
import { rateLimiter } from "@/server/http/rate-limit";
import { SESSION_COOKIE } from "@/server/auth/proxy-contract";

const USER = { id: "0199a1f0-0000-7000-8000-000000000001", permissions: [] };

const cookieJar = new Map<string, string>();
const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
    set: (cookie: { name: string; value: string }) => cookieJar.set(cookie.name, cookie.value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const session = vi.hoisted(() => ({
  startSession: vi.fn(async () => ({ token: "issued", expiresAt: new Date("2030-01-01") })),
  endSession: vi.fn(async () => {}),
}));

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  ...session,
}));

vi.mock("@/server/auth/current-user", () => ({
  requireUser: async () => USER,
}));

const service = vi.hoisted(() => ({
  authenticate: vi.fn(async (input: { username: string; password: string }) =>
    input.username === "ana" && input.password === "right" ? { id: USER.id } : null,
  ),
  changeOwnPassword: vi.fn(
    async (_userId: string, input: { currentPassword: string }) => input.currentPassword === "right",
  ),
}));

vi.mock("@/server/modules/auth/auth.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/modules/auth/auth.service")>()),
  ...service,
}));

beforeEach(() => {
  cookieJar.clear();
  requestHeaders.clear();
  rateLimiter.reset();
  vi.clearAllMocks();
});

describe("signIn", () => {
  it("starts a session and keeps its token in the cookie", async () => {
    const result = await signIn({ username: "ana", password: "right" });

    expect(result).toEqual({ ok: true });
    expect(session.startSession).toHaveBeenCalledWith(USER.id);
    expect(cookieJar.get(SESSION_COOKIE)).toBe("issued");
  });

  it("answers 401 for the wrong password and sets no cookie", async () => {
    const result = await signIn({ username: "ana", password: "wrong" });

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("answers 400 for a body the schema refuses, before touching the service", async () => {
    const result = await signIn({ username: "", password: "right" });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(service.authenticate).not.toHaveBeenCalled();
  });

  it("answers 429 once the attempts for one username from one address run out", async () => {
    requestHeaders.set("x-forwarded-for", "10.0.0.1");
    const statuses: (number | "ok")[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await signIn({ username: "ana", password: "wrong" });

      statuses.push(result.ok ? "ok" : result.status);
    }
    const other = await signIn({ username: "bob", password: "wrong" });

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(other).toMatchObject({ status: 401 });
  });
});

describe("signOut", () => {
  it("ends the session, drops the cookie and goes to the sign-in screen", async () => {
    cookieJar.set(SESSION_COOKIE, "issued");

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT /login");

    expect(session.endSession).toHaveBeenCalledWith("issued");
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("still leaves when there was no cookie to begin with", async () => {
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT /login");

    expect(session.endSession).not.toHaveBeenCalled();
  });
});

describe("changeOwnPassword", () => {
  it("answers 401 when the current password is wrong, and keeps the session", async () => {
    cookieJar.set(SESSION_COOKIE, "issued");

    const result = await changeOwnPassword({ currentPassword: "wrong", newPassword: "new-secret-1" });

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(cookieJar.get(SESSION_COOKIE)).toBe("issued");
  });

  it("drops the cookie after the change, because the service revoked every session", async () => {
    cookieJar.set(SESSION_COOKIE, "issued");

    const result = await changeOwnPassword({ currentPassword: "right", newPassword: "new-secret-1" });

    expect(result).toEqual({ ok: true });
    expect(service.changeOwnPassword).toHaveBeenCalledWith(USER.id, {
      currentPassword: "right",
      newPassword: "new-secret-1",
    });
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("answers 400 for a new password the schema refuses", async () => {
    const result = await changeOwnPassword({ currentPassword: "right", newPassword: "short" });

    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});
