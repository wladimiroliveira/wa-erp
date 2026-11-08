import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProductBodySchema, PRODUCT_CONFLICTS, updateProductBodySchema } from "./products.schemas";
import { createProduct, editProduct } from "./products.service";

const repository = vi.hoisted(() => ({
  findProductBySku: vi.fn(),
  findProductByDescription: vi.fn(),
  findPackagingByGtin: vi.fn(),
  insertProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

vi.mock("./products.repository", () => repository);

const SKU = "018f0000-0000-7000-8000-000000000020";
const OTHER_SKU = "018f0000-0000-7000-8000-000000000021";
const BAG_ID = "018f0000-0000-7000-8000-000000000101";
const SACK_ID = "018f0000-0000-7000-8000-000000000102";

const SUGAR = {
  sku: SKU,
  description: "AÇÚCAR",
  kind: "GOODS" as const,
  unit: "KILOGRAM" as const,
  isActive: true,
  minimumQuantity: null,
  packagings: [
    { id: BAG_ID, content: "1", gtin: "7891000100103", isActive: true },
    { id: SACK_ID, content: "5", gtin: null, isActive: false },
  ],
};

const create = (body: Record<string, unknown>) =>
  createProduct(createProductBodySchema.parse({ description: "açúcar", kind: "GOODS", unit: "KILOGRAM", ...body }));

const edit = (body: Record<string, unknown>) => editProduct(SKU, updateProductBodySchema.parse(body));

const uniqueViolation = (target: string[]) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });

beforeEach(() => {
  vi.clearAllMocks();
  repository.findProductBySku.mockResolvedValue(SUGAR);
  repository.findProductByDescription.mockResolvedValue(null);
  repository.findPackagingByGtin.mockResolvedValue(null);
  repository.insertProduct.mockResolvedValue(SUGAR);
  repository.updateProduct.mockResolvedValue(SUGAR);
});

describe("createProduct", () => {
  it("checks and writes the description in upper case", async () => {
    await create({});

    expect(repository.findProductByDescription).toHaveBeenCalledWith("AÇÚCAR");
    expect(repository.insertProduct).toHaveBeenCalledWith(expect.objectContaining({ description: "AÇÚCAR" }));
  });

  it("writes each packaging content in the product's unit", async () => {
    await create({
      packagings: [
        { content: "380", unit: "GRAM" },
        { content: "5", unit: "KILOGRAM", gtin: "7891000100103" },
      ],
    });

    expect(repository.insertProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        packagings: [
          { content: "0.38", gtin: null },
          { content: "5", gtin: "7891000100103" },
        ],
      }),
    );
  });

  it("refuses a packaging in a unit of another dimension", async () => {
    const result = await create({ packagings: [{ content: "1", unit: "LITER" }] });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(repository.insertProduct).not.toHaveBeenCalled();
  });

  it("refuses a content that does not fit the product's unit instead of rounding it", async () => {
    const result = await create({ packagings: [{ content: "0.0005", unit: "GRAM" }] });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(repository.insertProduct).not.toHaveBeenCalled();
  });

  it("refuses two packagings that hold the same content", async () => {
    const result = await create({
      packagings: [
        { content: "1000", unit: "GRAM" },
        { content: "1", unit: "KILOGRAM" },
      ],
    });

    expect(result).toEqual({ ok: false, status: 409, message: PRODUCT_CONFLICTS.content });
    expect(repository.insertProduct).not.toHaveBeenCalled();
  });

  it("refuses a GTIN already on a packaging of another product", async () => {
    repository.findPackagingByGtin.mockResolvedValue({ id: BAG_ID, productSku: OTHER_SKU });

    const result = await create({ packagings: [{ content: "1", unit: "KILOGRAM", gtin: "7891000100103" }] });

    expect(result).toEqual({ ok: false, status: 409, message: PRODUCT_CONFLICTS.gtin });
  });

  it("refuses a description already taken", async () => {
    repository.findProductByDescription.mockResolvedValue({ ...SUGAR, sku: OTHER_SKU });

    expect(await create({})).toEqual({ ok: false, status: 409, message: PRODUCT_CONFLICTS.description });
  });

  it("answers 409, not a crash, when a concurrent save takes the description first", async () => {
    repository.insertProduct.mockRejectedValue(uniqueViolation(["description"]));

    expect(await create({})).toEqual({ ok: false, status: 409, message: PRODUCT_CONFLICTS.description });
  });
});

describe("editProduct", () => {
  it("answers 404 for an unknown product", async () => {
    repository.findProductBySku.mockResolvedValue(null);

    expect(await edit({ isActive: false })).toMatchObject({ ok: false, status: 404 });
  });

  it("keeps a GTIN that is already on its own packaging", async () => {
    repository.findPackagingByGtin.mockResolvedValue({ id: BAG_ID, productSku: SKU });

    const result = await edit({ packagings: [{ id: BAG_ID, content: "1", unit: "KILOGRAM", gtin: "7891000100103" }] });

    expect(result.ok).toBe(true);
  });

  it("refuses a packaging id that is not one of the product's", async () => {
    const result = await edit({
      packagings: [{ id: "018f0000-0000-7000-8000-000000000999", content: "1", unit: "KILOGRAM" }],
    });

    expect(result).toEqual({ ok: false, status: 404, message: "Packaging not found." });
    expect(repository.updateProduct).not.toHaveBeenCalled();
  });

  it("syncs the list: converted contents, stored activity kept unless sent, new rows active", async () => {
    await edit({
      packagings: [
        { id: BAG_ID, content: "1000", unit: "GRAM", gtin: "7891000100103" },
        { id: SACK_ID, content: "5", unit: "KILOGRAM", isActive: true },
        { content: "500", unit: "GRAM" },
      ],
    });

    expect(repository.updateProduct).toHaveBeenCalledWith(SKU, {
      packagings: [
        { id: BAG_ID, content: "1", gtin: "7891000100103", isActive: true },
        { id: SACK_ID, content: "5", gtin: null, isActive: true },
        { content: "0.5", gtin: null, isActive: true },
      ],
    });
  });

  it("leaves the packagings alone when the list is not sent", async () => {
    await edit({ isActive: false });

    expect(repository.updateProduct).toHaveBeenCalledWith(SKU, { isActive: false });
  });

  it.each([
    [["product_sku", "content"], PRODUCT_CONFLICTS.content],
    [["gtin"], PRODUCT_CONFLICTS.gtin],
    [["description"], PRODUCT_CONFLICTS.description],
  ])("answers 409 when the write hits the unique index on %j", async (target, message) => {
    repository.updateProduct.mockRejectedValue(uniqueViolation(target));

    const result = await edit({
      packagings: [
        { id: BAG_ID, content: "5", unit: "KILOGRAM" },
        { id: SACK_ID, content: "1", unit: "KILOGRAM" },
      ],
    });

    expect(result).toEqual({ ok: false, status: 409, message });
  });
});
