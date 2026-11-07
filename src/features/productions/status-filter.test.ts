import { describe, expect, it } from "vitest";
import { readStatusFilter, statusOfFilter } from "@/features/productions/status-filter";

describe("readStatusFilter", () => {
  it.each(["IN_PROGRESS", "FINISHED", "CANCELED", "all"])("keeps %s", (raw) => {
    expect(readStatusFilter(raw)).toBe(raw);
  });

  it.each([undefined, "", "finished", "DONE", ["FINISHED", "CANCELED"]])("reads %j as in progress", (raw) => {
    expect(readStatusFilter(raw)).toBe("IN_PROGRESS");
  });
});

describe("statusOfFilter", () => {
  it("lists every status for all", () => {
    expect(statusOfFilter("all")).toBeUndefined();
  });

  it("lists one status otherwise", () => {
    expect(statusOfFilter("CANCELED")).toBe("CANCELED");
  });
});
