import { describe, expect, it } from "vitest";
import { fail, failWith } from "./result";

describe("failWith", () => {
  it("keeps the details of a refusal", () => {
    expect(failWith(409, "x", { a: 1 })).toEqual({
      ok: false,
      status: 409,
      message: "x",
      details: { a: 1 },
    });
  });

  it("leaves fail without details", () => {
    expect(fail(404, "missing")).toEqual({ ok: false, status: 404, message: "missing" });
    expect(fail(404, "missing")).not.toHaveProperty("details");
  });
});
