import { describe, expect, it } from "vitest";
import { returnPathOf, signInUrl } from "@/shared/sign-in";

describe("signInUrl", () => {
  it("is the bare sign-in screen when there is nowhere to go back to", () => {
    expect(signInUrl(null)).toBe("/login");
  });

  it("carries the way back in `from`", () => {
    expect(signInUrl("/daf?page=2")).toBe("/login?from=%2Fdaf%3Fpage%3D2");
  });
});

describe("returnPathOf", () => {
  it("goes back to a path of the application", () => {
    expect(returnPathOf(new URLSearchParams({ from: "/daf?page=2" }))).toBe("/daf?page=2");
  });

  it("refuses an address outside the application", () => {
    expect(returnPathOf(new URLSearchParams({ from: "https://evil.test/" }))).toBe("/");
    expect(returnPathOf(new URLSearchParams({ from: "//evil.test/" }))).toBe("/");
  });

  it("falls back to the home screen without `from`", () => {
    expect(returnPathOf(new URLSearchParams())).toBe("/");
  });
});
