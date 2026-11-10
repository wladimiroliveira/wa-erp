import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "./proxy-contract";
import { leaveStaleSession } from "./stale-session";

vi.mock("./session", () => ({
  findSessionUser: async (token: string) => (token === "valid" ? { id: "user", permissions: [] } : null),
}));

const visit = (path: string, token?: string) =>
  leaveStaleSession(
    new NextRequest(`http://localhost:3000${path}`, {
      headers: token === undefined ? {} : { cookie: `${SESSION_COOKIE}=${token}` },
    }),
  );

const locationOf = (response: Response) => new URL(response.headers.get("location") ?? "");

describe("leaveStaleSession", () => {
  it("drops a cookie that no longer opens a session and goes to sign in, keeping the way back", async () => {
    const response = await visit("/session-ended?from=%2Fstock%3Ftab%3D2", "stale");

    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
    expect(locationOf(response).pathname).toBe("/login");
    expect(locationOf(response).searchParams.get("from")).toBe("/stock?tab=2");
  });

  // Anyone can link here: a session that still opens must not be ended by following that link.
  it("keeps a cookie that still opens a session", async () => {
    const response = await visit("/session-ended?from=%2Fstock", "valid");

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(locationOf(response).pathname).toBe("/login");
  });

  it("goes to sign in with no way back when there is none", async () => {
    const response = await visit("/session-ended");

    expect(locationOf(response).pathname).toBe("/login");
    expect([...locationOf(response).searchParams.keys()]).toEqual([]);
  });

  it("leaves out a way back to another site", async () => {
    const response = await visit("/session-ended?from=%2F%2Fevil.example", "stale");

    expect(locationOf(response).host).toBe("localhost:3000");
    expect(locationOf(response).searchParams.has("from")).toBe(false);
  });
});
