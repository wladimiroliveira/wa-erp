import { describe, expect, it } from "vitest";
import { createProductBodySchema, updateProductBodySchema } from "./products.schemas";

const SUGAR = { description: "Açúcar refinado", kind: "GOODS", unit: "KILOGRAM" } as const;

describe("product description", () => {
  it("is trimmed and upper-cased, accents included", () => {
    expect(createProductBodySchema.parse({ ...SUGAR, description: "  açúcar refinado " }).description).toBe(
      "AÇÚCAR REFINADO",
    );
  });
});

describe("product packagings", () => {
  it("refuses a GTIN whose check digit does not match", () => {
    const packagings = [{ content: "1", unit: "KILOGRAM", gtin: "7891000100104" }];

    expect(createProductBodySchema.safeParse({ ...SUGAR, packagings }).success).toBe(false);
  });

  it("takes a GTIN whose check digit matches", () => {
    const packagings = [{ content: "1", unit: "KILOGRAM", gtin: "7891000100103" }];

    expect(createProductBodySchema.parse({ ...SUGAR, packagings }).packagings).toEqual(packagings);
  });

  it("refuses the same GTIN on two packagings of one list", () => {
    const packagings = [
      { content: "1", unit: "KILOGRAM", gtin: "7891000100103" },
      { content: "5", unit: "KILOGRAM", gtin: "7891000100103" },
    ];
    const created = createProductBodySchema.safeParse({ ...SUGAR, packagings });
    const updated = updateProductBodySchema.safeParse({ packagings });

    expect(created.error?.issues.map((issue) => issue.message)).toContain("A GTIN is listed more than once.");
    expect(updated.error?.issues.map((issue) => issue.message)).toContain("A GTIN is listed more than once.");
  });

  it("takes several packagings without a GTIN", () => {
    const packagings = [
      { content: "1", unit: "KILOGRAM" },
      { content: "500", unit: "GRAM" },
    ];

    expect(createProductBodySchema.safeParse({ ...SUGAR, packagings }).success).toBe(true);
  });
});

describe("product GTIN", () => {
  it("is no longer a field of the product", () => {
    const created = createProductBodySchema.parse({ ...SUGAR, gtin: "7891000100103" });
    const updated = updateProductBodySchema.parse({ gtin: "7891000100103", isActive: false });

    expect(created).not.toHaveProperty("gtin");
    expect(updated).not.toHaveProperty("gtin");
  });

  it("still refuses an update with nothing to change", () => {
    expect(updateProductBodySchema.safeParse({}).error?.issues[0]?.message).toBe("Nothing to update.");
  });
});
