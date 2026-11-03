import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as signin from "@/app/v1/sessions/signin/route";
import { rateLimiter } from "@/server/http/rate-limit";
import { resetDatabase, testPrisma } from "@/server/testing/database";
import { inject } from "@/server/testing/inject";

const attemptLogin = (username: string) =>
  inject(signin, { method: "POST", url: "/v1/sessions/signin", payload: { username, password: "wrong" } });

beforeEach(() => {
  rateLimiter.reset();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("POST /v1/sessions/signin rate limit", () => {
  it("answers 429 once the attempts for one username run out", async () => {
    const codes: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      codes.push((await attemptLogin("target")).statusCode);
    }

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
  });

  it("does not spend another username's attempts", async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) await attemptLogin("target");

    expect((await attemptLogin("someone-else")).statusCode).toBe(401);
  });
});
