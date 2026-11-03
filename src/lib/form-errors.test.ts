import { describe, expect, it } from "vitest";
import { messageForFailure } from "@/lib/form-errors";

describe("messageForFailure", () => {
  it("prefers the caller's wording for a status it knows the meaning of", () => {
    expect(
      messageForFailure({ ok: false, status: 409, message: "Taken." }, { 409: "Já existe um papel com esse nome." }),
    ).toBe("Já existe um papel com esse nome.");
  });

  it("never leaks the server's own English message to the screen", () => {
    const message = messageForFailure({ ok: false, status: 404, message: "Something exploded." });

    expect(message).not.toContain("Something exploded.");
    expect(message).toBe("Não foi possível concluir a operação. Tente de novo.");
  });

  it("survives an action that threw instead of answering", () => {
    expect(messageForFailure(new TypeError("boom"))).toBe("Não foi possível concluir a operação. Tente de novo.");
  });
});
