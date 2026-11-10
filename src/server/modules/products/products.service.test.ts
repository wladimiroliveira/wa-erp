import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProductBodySchema, PRODUCT_CONFLICTS, updateProductBodySchema } from "./products.schemas";
import { createProduct, editProduct } from "./products.service";

const repository = vi.hoisted(() => ({
  findProductBySku: vi.fn(),
  findProductByDescription: vi.fn(),
  findPackagingByGtin: vi.fn(),
  findPackagingsWithLots: vi.fn(),
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
    { id: BAG_ID, brand: "UNIÃO", content: "1", gtin: "7891000100103", isActive: true },
    { id: SACK_ID, brand: "UNIÃO", content: "5", gtin: null, isActive: false },
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
  repository.findPackagingsWithLots.mockResolvedValue([]);
  repository.insertProduct.mockResolvedValue(SUGAR);
  repository.updateProduct.mockResolvedValue(SUGAR);
});

describe("createProduct", () => {
  it("writes one description one way, however its accents were encoded", () => {
    const decomposed = "ac\u0327u\u0301car"; // c + combining cedilla, u + combining acute

    expect(
      createProductBodySchema.parse({ description: decomposed, kind: "GOODS", unit: "KILOGRAM" }).description,
    ).toBe("AÇÚCAR".normalize("NFC"));
  });

  it("checks and writes the description in upper case", async () => {
    await create({});

    expect(repository.findProductByDescription).toHaveBeenCalledWith("AÇÚCAR");
    expect(repository.insertProduct).toHaveBeenCalledWith(expect.objectContaining({ description: "AÇÚCAR" }));
  });

  it("keeps a product once opened unless it is said otherwise", () => {
    const body = { description: "leite condensado", kind: "GOODS", unit: "GRAM" };

    expect(createProductBodySchema.parse(body).isStorableOnceOpened).toBe(true);
    expect(createProductBodySchema.parse({ ...body, isStorableOnceOpened: false }).isStorableOnceOpened).toBe(false);
    expect(updateProductBodySchema.parse({ isStorableOnceOpened: false })).toEqual({ isStorableOnceOpened: false });
  });

  it("writes each packaging content in the product's unit", async () => {
    await create({
      packagings: [
        { brand: "UNIÃO", content: "380", unit: "GRAM" },
        { brand: "UNIÃO", content: "5", unit: "KILOGRAM", gtin: "7891000100103" },
      ],
    });

    expect(repository.insertProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        packagings: [
          { brand: "UNIÃO", content: "0.38", gtin: null },
          { brand: "UNIÃO", content: "5", gtin: "7891000100103" },
        ],
      }),
    );
  });

  it("refuses a packaging in a unit of another dimension", async () => {
    const result = await create({ packagings: [{ brand: "UNIÃO", content: "1", unit: "LITER" }] });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(repository.insertProduct).not.toHaveBeenCalled();
  });

  it("refuses a content that does not fit the product's unit instead of rounding it", async () => {
    const result = await create({ packagings: [{ brand: "UNIÃO", content: "0.0005", unit: "GRAM" }] });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(repository.insertProduct).not.toHaveBeenCalled();
  });

  it("refuses two packagings of one brand that hold the same content", async () => {
    const result = await create({
      packagings: [
        { brand: "união", content: "1000", unit: "GRAM" },
        { brand: "UNIÃO", content: "1", unit: "KILOGRAM" },
      ],
    });

    expect(result).toEqual({ ok: false, status: 409, message: PRODUCT_CONFLICTS.brandAndContent });
    expect(repository.insertProduct).not.toHaveBeenCalled();
  });

  it("takes the same content under two brands", async () => {
    const result = await create({
      packagings: [
        { brand: "União", content: "1", unit: "KILOGRAM" },
        { brand: "Caravelas", content: "1000", unit: "GRAM" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(repository.insertProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        packagings: [
          { brand: "UNIÃO", content: "1", gtin: null },
          { brand: "CARAVELAS", content: "1", gtin: null },
        ],
      }),
    );
  });

  it("answers 409 when a concurrent save takes the brand and content first", async () => {
    repository.insertProduct.mockRejectedValue(uniqueViolation(["product_sku", "brand", "content"]));

    const result = await create({ packagings: [{ brand: "União", content: "1", unit: "KILOGRAM" }] });

    expect(result).toEqual({ ok: false, status: 409, message: PRODUCT_CONFLICTS.brandAndContent });
  });

  it("refuses a GTIN already on a packaging of another product", async () => {
    repository.findPackagingByGtin.mockResolvedValue({ id: BAG_ID, productSku: OTHER_SKU });

    const result = await create({
      packagings: [{ brand: "UNIÃO", content: "1", unit: "KILOGRAM", gtin: "7891000100103" }],
    });

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

    const result = await edit({
      packagings: [{ id: BAG_ID, brand: "UNIÃO", content: "1", unit: "KILOGRAM", gtin: "7891000100103" }],
    });

    expect(result.ok).toBe(true);
  });

  it("refuses a packaging id that is not one of the product's", async () => {
    const result = await edit({
      packagings: [{ id: "018f0000-0000-7000-8000-000000000999", brand: "UNIÃO", content: "1", unit: "KILOGRAM" }],
    });

    expect(result).toEqual({ ok: false, status: 404, message: "Packaging not found." });
    expect(repository.updateProduct).not.toHaveBeenCalled();
  });

  it("syncs the list: converted contents, stored activity kept unless sent, new rows active", async () => {
    await edit({
      packagings: [
        { id: BAG_ID, brand: "UNIÃO", content: "1000", unit: "GRAM", gtin: "7891000100103" },
        { id: SACK_ID, brand: "UNIÃO", content: "5", unit: "KILOGRAM", isActive: true },
        { brand: "UNIÃO", content: "500", unit: "GRAM" },
      ],
    });

    expect(repository.updateProduct).toHaveBeenCalledWith(SKU, {
      packagings: [
        { id: BAG_ID, brand: "UNIÃO", content: "1", gtin: "7891000100103", isActive: true },
        { id: SACK_ID, brand: "UNIÃO", content: "5", gtin: null, isActive: true },
        { brand: "UNIÃO", content: "0.5", gtin: null, isActive: true },
      ],
    });
  });

  it("refuses to remove a packaging that stock lots came in", async () => {
    repository.findPackagingsWithLots.mockResolvedValue([SACK_ID]);

    const result = await edit({ packagings: [{ id: BAG_ID, brand: "UNIÃO", content: "1", unit: "KILOGRAM" }] });

    expect(result).toEqual({ ok: false, status: 409, message: PRODUCT_CONFLICTS.inUse });
    expect(repository.updateProduct).not.toHaveBeenCalled();
  });

  it("refuses to change the content of a packaging stock lots came in", async () => {
    repository.findPackagingsWithLots.mockResolvedValue([BAG_ID]);

    const result = await edit({
      packagings: [
        { id: BAG_ID, brand: "UNIÃO", content: "2", unit: "KILOGRAM" },
        { id: SACK_ID, brand: "UNIÃO", content: "5", unit: "KILOGRAM" },
      ],
    });

    expect(result).toEqual({ ok: false, status: 409, message: PRODUCT_CONFLICTS.contentLocked });
    expect(repository.updateProduct).not.toHaveBeenCalled();
  });

  it("lets the brand of a packaging stock lots came in be corrected", async () => {
    repository.findPackagingsWithLots.mockResolvedValue([BAG_ID]);

    const result = await edit({
      packagings: [
        { id: BAG_ID, brand: "Uniao", content: "1", unit: "KILOGRAM" },
        { id: SACK_ID, brand: "UNIÃO", content: "5", unit: "KILOGRAM" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(repository.updateProduct).toHaveBeenCalledWith(SKU, {
      packagings: [
        { id: BAG_ID, brand: "UNIAO", content: "1", gtin: null, isActive: true },
        { id: SACK_ID, brand: "UNIÃO", content: "5", gtin: null, isActive: false },
      ],
    });
  });

  it("keeps the content of a packaging with lots when it is sent in another unit", async () => {
    repository.findPackagingsWithLots.mockResolvedValue([BAG_ID]);

    const result = await edit({
      packagings: [
        { id: BAG_ID, brand: "UNIÃO", content: "1000", unit: "GRAM", gtin: "7891000100103" },
        { id: SACK_ID, brand: "UNIÃO", content: "5", unit: "KILOGRAM" },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("removes a packaging no lot came in", async () => {
    repository.findPackagingsWithLots.mockResolvedValue([BAG_ID]);

    const result = await edit({ packagings: [{ id: BAG_ID, brand: "UNIÃO", content: "1", unit: "KILOGRAM" }] });

    expect(result.ok).toBe(true);
  });

  it("leaves the packagings alone when the list is not sent", async () => {
    await edit({ isActive: false });

    expect(repository.updateProduct).toHaveBeenCalledWith(SKU, { isActive: false });
  });

  it("lets a unique violation it does not know of through, instead of calling it a description taken", async () => {
    repository.updateProduct.mockRejectedValue(uniqueViolation(["some_other_column"]));

    await expect(edit({ description: "açúcar mascavo" })).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it("refuses a list that names one stored packaging twice", () => {
    expect(
      updateProductBodySchema.safeParse({
        packagings: [
          { id: BAG_ID, brand: "UNIÃO", content: "1", unit: "KILOGRAM" },
          { id: BAG_ID.toUpperCase(), brand: "UNIÃO", content: "5", unit: "KILOGRAM" },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    [["product_sku", "brand", "content"], PRODUCT_CONFLICTS.brandAndContent],
    [["gtin"], PRODUCT_CONFLICTS.gtin],
    [["description"], PRODUCT_CONFLICTS.description],
  ])("answers 409 when the write hits the unique index on %j", async (target, message) => {
    repository.updateProduct.mockRejectedValue(uniqueViolation(target));

    const result = await edit({
      packagings: [
        { id: BAG_ID, brand: "UNIÃO", content: "5", unit: "KILOGRAM" },
        { id: SACK_ID, brand: "UNIÃO", content: "1", unit: "KILOGRAM" },
      ],
    });

    expect(result).toEqual({ ok: false, status: 409, message });
  });
});
