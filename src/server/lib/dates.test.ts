import { describe, expect, it } from "vitest";
import { localDayRange, toOptionalDateString } from "@/server/lib/dates";

describe("toOptionalDateString", () => {
  it("answers the day of a date", () => {
    expect(toOptionalDateString(new Date("2026-03-01T00:00:00.000Z"))).toBe("2026-03-01");
  });

  it("answers null for no date", () => {
    expect(toOptionalDateString(null)).toBeNull();
  });
});

describe("localDayRange", () => {
  it("runs from local midnight of the first day to local midnight after the last", () => {
    const { gte, lt } = localDayRange("2026-11-01", "2026-11-30");

    expect(gte).toEqual(new Date(2026, 10, 1, 0, 0, 0));
    expect(lt).toEqual(new Date(2026, 11, 1, 0, 0, 0));
  });
});
