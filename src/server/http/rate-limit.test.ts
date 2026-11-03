import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/server/http/rate-limit";

const RULE = { max: 2, timeWindowMs: 60_000, keyGenerator: () => "" };

describe("RateLimiter", () => {
  it("allows as many attempts as the rule says, then refuses", () => {
    const limiter = new RateLimiter();

    expect(limiter.consume("a", RULE, 0)).toEqual({ allowed: true });
    expect(limiter.consume("a", RULE, 1)).toEqual({ allowed: true });
    expect(limiter.consume("a", RULE, 2)).toEqual({ allowed: false, retryAfterMs: 59_998 });
  });

  it("keeps one key's budget apart from another's", () => {
    const limiter = new RateLimiter();

    limiter.consume("a", RULE, 0);
    limiter.consume("a", RULE, 0);
    limiter.consume("a", RULE, 0);

    expect(limiter.consume("b", RULE, 0)).toEqual({ allowed: true });
  });

  it("gives the budget back once the window has passed", () => {
    const limiter = new RateLimiter();

    limiter.consume("a", RULE, 0);
    limiter.consume("a", RULE, 0);
    limiter.consume("a", RULE, 0);

    expect(limiter.consume("a", RULE, 60_000)).toEqual({ allowed: true });
  });
});
