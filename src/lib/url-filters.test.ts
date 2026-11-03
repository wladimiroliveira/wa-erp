import { describe, expect, it } from "vitest";
import { readList, readText, withValues } from "@/lib/url-filters";

const COLORS = ["RED", "BLUE"] as const;

describe("url filters", () => {
  it("reads the known values of a repeated parameter, in the order they were written", () => {
    expect(readList(new URLSearchParams("color=BLUE&color=GREEN&color=RED"), "color", COLORS)).toEqual(["BLUE", "RED"]);
  });

  it("reads a missing list as empty", () => {
    expect(readList(new URLSearchParams(), "color", COLORS)).toEqual([]);
  });

  it("reads a text parameter trimmed, and a blank one as missing", () => {
    expect(readText(new URLSearchParams("q=%20farinha%20"), "q")).toBe("farinha");
    expect(readText(new URLSearchParams("q=%20%20"), "q")).toBeUndefined();
    expect(readText(new URLSearchParams(), "q")).toBeUndefined();
  });

  it("replaces the values of one parameter and keeps the others", () => {
    const next = withValues(new URLSearchParams("q=pão&color=RED"), "color", ["BLUE", "RED"]);

    expect([...next]).toEqual([
      ["q", "pão"],
      ["color", "BLUE"],
      ["color", "RED"],
    ]);
  });

  it("drops a parameter left with no value, or with a blank one", () => {
    expect(withValues(new URLSearchParams("q=pão&color=RED"), "color", []).toString()).toBe("q=p%C3%A3o");
    expect(withValues(new URLSearchParams("q=pão"), "q", ["  "]).toString()).toBe("");
  });

  it("leaves the parameters it was given untouched", () => {
    const params = new URLSearchParams("color=RED");

    withValues(params, "color", []);

    expect(params.toString()).toBe("color=RED");
  });
});
