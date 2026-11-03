export type RateLimitRule = {
  max: number;
  timeWindowMs: number;
};

type Window = { count: number; resetAt: number };

/**
 * Counts attempts per key inside a window that starts at the first attempt. It lives in the memory
 * of the process, so each running instance keeps its own budget; that is the same guarantee the
 * rate-limit plugin of the previous API gave, and enough to slow a password sweep.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  /** Spends one attempt. Returns how long until the budget is back when there is none left. */
  consume(
    key: string,
    rule: RateLimitRule,
    now = Date.now(),
  ): { allowed: true } | { allowed: false; retryAfterMs: number } {
    this.forget(now);

    const window = this.windows.get(key) ?? { count: 0, resetAt: now + rule.timeWindowMs };

    window.count += 1;
    this.windows.set(key, window);

    if (window.count > rule.max) return { allowed: false, retryAfterMs: window.resetAt - now };

    return { allowed: true };
  }

  /** Forgets every budget. For the tests, which would otherwise spend one another's attempts. */
  reset(): void {
    this.windows.clear();
  }

  private forget(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}

/** The one limiter every route handler of the process shares. */
export const rateLimiter = new RateLimiter();
