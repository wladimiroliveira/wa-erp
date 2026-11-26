import { describe, expect, it } from "vitest";
import { batchBodySchema, damageProductionItemBodySchema, productionLeftoversQuerySchema } from "./productions.schemas";

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

describe("productionLeftoversQuerySchema", () => {
  it("takes only the items asked for", () => {
    expect(Object.keys(productionLeftoversQuerySchema.shape)).toEqual(["items"]);
  });
});

describe("batchBodySchema", () => {
  it("reads a missing expiry as none", () => {
    expect(batchBodySchema.parse({ quantity: "10", source: "PRODUCED" }).expiresAt).toBeNull();
  });

  it("keeps an expiry sent as none", () => {
    expect(batchBodySchema.parse({ quantity: "10", source: "PRODUCED", expiresAt: null }).expiresAt).toBeNull();
  });
});
