import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, todayIso } from "@/lib/dates";

describe("formatDateTime", () => {
  // Midday UTC is the same calendar day in every timezone the suite may run in.
  it("writes an API timestamp as a Brazilian date and time", () => {
    expect(formatDateTime("2026-10-02T12:00:00.000Z")).toMatch(/^02\/10\/2026 \d{2}:00$/);
  });
});

describe("formatDate", () => {
  it("writes an API calendar day the Brazilian way, whatever the timezone", () => {
    expect(formatDate("2099-12-31")).toBe("31/12/2099");
  });
});

describe("todayIso", () => {
  it("writes the operator's own calendar day the way a date field holds it", () => {
    expect(todayIso(new Date(2026, 9, 5, 23, 30))).toBe("2026-10-05");
  });
});
