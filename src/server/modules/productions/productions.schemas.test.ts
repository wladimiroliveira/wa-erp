import { describe, expect, it } from "vitest";
import { damageProductionItemBodySchema } from "./productions.schemas";

const REASON_ID = "018f0000-0000-7000-8000-000000000071";

describe("damageProductionItemBodySchema", () => {
  it.each(["", "   "])("reads a blank note (%j) as none", (note) => {
    expect(damageProductionItemBodySchema.parse({ reasonId: REASON_ID, note }).note).toBeNull();
  });

  it("keeps a note trimmed", () => {
    expect(damageProductionItemBodySchema.parse({ reasonId: REASON_ID, note: "  caiu " }).note).toBe("caiu");
  });

  it("leaves a missing note missing", () => {
    expect(damageProductionItemBodySchema.parse({ reasonId: REASON_ID }).note).toBeUndefined();
  });
});
