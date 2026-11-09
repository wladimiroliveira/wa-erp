import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findSchemaConventionViolations } from "@/server/prisma/schema-convention";

const SCHEMA = readFileSync(fileURLToPath(new URL("../schema.prisma", import.meta.url)), "utf8");

function enumValues(name: string): string[] {
  const block = new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA);
  expect(block).not.toBeNull();

  return block![1]!
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("@@"));
}

const modelField = (model: string) => (pattern: string) =>
  new RegExp(`model ${model} \\{[^}]*?\\n\\s+${pattern}[^}]*?\\n\\}`);

const productField = modelField("Product");
const packagingField = modelField("ProductPackaging");

describe("catalog schema", () => {
  it("keeps goods and manufactured products in a single table", () => {
    expect(SCHEMA).toMatch(/model Product \{[\s\S]*?@@map\("products"\)/);
    expect(enumValues("ProductKind").sort()).toEqual(["GOODS", "MANUFACTURED"]);
    expect(SCHEMA).toMatch(/enum ProductKind \{[\s\S]*?@@map\("product_kind"\)/);
    expect(SCHEMA).toMatch(productField(String.raw`kind\s+ProductKind\b`));
  });

  it("identifies a product by its SKU, a UUIDv7 primary key", () => {
    expect(SCHEMA).toMatch(productField(String.raw`sku\s+String\s+@id @default\(uuid\(7\)\) @db\.Uuid`));
    expect(SCHEMA).not.toMatch(productField(String.raw`id\s+String`));
  });

  it("keeps the GTIN off the product: each packaging has its own", () => {
    expect(SCHEMA).not.toMatch(productField(String.raw`gtin\s`));
    expect(SCHEMA).toMatch(productField(String.raw`packagings\s+ProductPackaging\[\]`));
  });

  it("gives a packaging at most one GTIN, and a GTIN at most one packaging", () => {
    expect(SCHEMA).toMatch(/model ProductPackaging \{[\s\S]*?@@map\("product_packagings"\)/);
    expect(SCHEMA).toMatch(packagingField(String.raw`gtin\s+String\?\s+@unique`));
  });

  it("measures a packaging's content in its product's unit, once per product", () => {
    expect(SCHEMA).toMatch(packagingField(String.raw`content\s+Decimal\s+@db\.Decimal\(18, 6\)`));
    expect(SCHEMA).toMatch(packagingField(String.raw`@@unique\(\[productSku, content\]`));
  });

  it("measures a product in a single unit from a fixed set", () => {
    expect(enumValues("MeasurementUnit").sort()).toEqual(["GRAM", "KILOGRAM", "LITER", "MILLILITER", "UNIT"]);
    expect(SCHEMA).toMatch(/enum MeasurementUnit \{[\s\S]*?@@map\("measurement_unit"\)/);
    expect(SCHEMA).toMatch(productField(String.raw`unit\s+MeasurementUnit\b`));
  });

  it("deactivates a product instead of deleting it", () => {
    expect(SCHEMA).toMatch(productField(String.raw`isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)`));
  });

  it("says whether a product keeps once its packaging is opened, keeping by default", () => {
    expect(SCHEMA).toMatch(
      productField(String.raw`isStorableOnceOpened\s+Boolean\s+@default\(true\)\s+@map\("is_storable_once_opened"\)`),
    );
  });

  it("violates no rule of the table convention", () => {
    expect(findSchemaConventionViolations(SCHEMA)).toEqual([]);
  });
});
