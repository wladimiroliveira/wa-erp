import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEntryBodySchema, ENTRY_REFUSALS } from "./entries.schemas";
import { recordEntry } from "./entries.service";

const repository = vi.hoisted(() => ({ findProductBySku: vi.fn(), insertEntry: vi.fn() }));

vi.mock("./entries.repository", async (importActual) => ({
  ...(await importActual<typeof import("./entries.repository")>()),
  ...repository,
}));
vi.mock("@/server/modules/suppliers/suppliers.repository", () => ({ findSupplierById: vi.fn() }));

const SKU = "018f0000-0000-7000-8000-000000000020";
const BAG = "018f0000-0000-7000-8000-000000000101";
const SACK = "018f0000-0000-7000-8000-000000000102";
const USER = "018f0000-0000-7000-8000-000000000001";

const FLOUR = {
  sku: SKU,
  description: "FARINHA",
  unit: "KILOGRAM" as const,
  isActive: true,
  packagings: [
    { id: BAG, content: "0.38", isActive: true },
    { id: SACK, content: "5000", isActive: false },
  ],
};

const recorded = (
  packaging: { id: string; content: string } | null,
  packageCount: number | null,
  packagePrice: string | null = null,
) => ({
  movement: {
    id: "018f0000-0000-7000-8000-000000000301",
    type: "ENTRY",
    quantity: new Prisma.Decimal("3.8"),
    unitCost: new Prisma.Decimal("11.842105"),
    createdAt: new Date("2026-11-08T12:00:00Z"),
  },
  lot: {
    id: "018f0000-0000-7000-8000-000000000201",
    expiresAt: null,
    supplier: null,
    quantity: new Prisma.Decimal("3.8"),
    packageCount,
    packagePrice: packagePrice === null ? null : new Prisma.Decimal(packagePrice),
    packaging: packaging && { id: packaging.id, content: new Prisma.Decimal(packaging.content) },
  },
  stock: {
    quantity: new Prisma.Decimal("3.8"),
    lastEntryCost: new Prisma.Decimal("11.842105"),
    averageCost: new Prisma.Decimal("11.842105"),
  },
});

const packaged = (over: Record<string, unknown> = {}) =>
  createEntryBodySchema.parse({
    productSku: SKU,
    packagingId: BAG,
    packageCount: 10,
    packagePrice: "4.50",
    expiresAt: null,
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  repository.findProductBySku.mockResolvedValue(FLOUR);
  repository.insertEntry.mockResolvedValue(recorded({ id: BAG, content: "0.38" }, 10, "4.50"));
});

describe("recordEntry by packaging", () => {
  it("records the packagings as a quantity and a cost in the product's unit", async () => {
    await recordEntry(packaged(), USER);

    expect(repository.insertEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: "3.8",
        unitCost: "11.842105",
        packagingId: BAG,
        packageCount: 10,
        packagePrice: "4.50",
      }),
    );
  });

  it("answers the lot with its packaging, count and price", async () => {
    const result = await recordEntry(packaged(), USER);

    expect(result.ok && result.data.lot.packaging).toEqual({ id: BAG, content: "0.38", count: 10, price: "4.5" });
  });

  it("refuses a packaging that is not the product's", async () => {
    const result = await recordEntry(packaged({ packagingId: "018f0000-0000-7000-8000-000000000999" }), USER);

    expect(result).toEqual({ ok: false, status: 404, message: "Packaging not found." });
    expect(repository.insertEntry).not.toHaveBeenCalled();
  });

  it("refuses a package price whose cost per unit the stock cannot hold, before writing anything", async () => {
    repository.findProductBySku.mockResolvedValue({
      ...FLOUR,
      packagings: [{ id: BAG, content: "0.000001", isActive: true }],
    });

    const result = await recordEntry(packaged({ packageCount: 1, packagePrice: "999999999999.99" }), USER);

    expect(result).toEqual({ ok: false, status: 400, message: ENTRY_REFUSALS.costTooLarge });
    expect(repository.insertEntry).not.toHaveBeenCalled();
  });

  it("answers 404, not a crash, when the packaging is removed while the entry is written", async () => {
    repository.insertEntry.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Foreign key constraint violated", {
        code: "P2003",
        clientVersion: "6",
      }),
    );

    expect(await recordEntry(packaged(), USER)).toEqual({
      ok: false,
      status: 404,
      message: ENTRY_REFUSALS.packagingNotFound,
    });
  });

  it("refuses an inactive packaging", async () => {
    const result = await recordEntry(packaged({ packagingId: SACK }), USER);

    expect(result).toEqual({ ok: false, status: 409, message: "Packaging is inactive." });
  });

  it("refuses a quantity the stock cannot hold, before writing anything", async () => {
    repository.findProductBySku.mockResolvedValue({
      ...FLOUR,
      packagings: [{ id: BAG, content: "100000000", isActive: true }],
    });

    const result = await recordEntry(packaged({ packageCount: 99999 }), USER);

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(repository.insertEntry).not.toHaveBeenCalled();
  });
});

describe("recordEntry in the product's unit", () => {
  it("records the quantity and cost as typed, with no packaging", async () => {
    repository.insertEntry.mockResolvedValue(recorded(null, null));

    const result = await recordEntry(
      createEntryBodySchema.parse({ productSku: SKU, quantity: "3.8", unitCost: "11.842105", expiresAt: null }),
      USER,
    );

    expect(repository.insertEntry).toHaveBeenCalledWith({
      productSku: SKU,
      quantity: "3.8",
      unitCost: "11.842105",
      expiresAt: null,
      createdById: USER,
    });
    expect(result.ok && result.data.lot.packaging).toBeNull();
  });
});

describe("createEntryBodySchema", () => {
  const base = { productSku: SKU, expiresAt: null };

  it.each([
    ["both shapes at once", { quantity: "1", unitCost: "1", packagingId: BAG, packageCount: 1, packagePrice: "1" }],
    ["a package price with 3 decimals", { packagingId: BAG, packageCount: 1, packagePrice: "4.505" }],
    ["a fractional package count", { packagingId: BAG, packageCount: 1.5, packagePrice: "4.50" }],
    ["a package count of zero", { packagingId: BAG, packageCount: 0, packagePrice: "4.50" }],
    ["more than 99 999 packagings", { packagingId: BAG, packageCount: 100000, packagePrice: "4.50" }],
  ])("refuses %s", (_label, body) => {
    expect(createEntryBodySchema.safeParse({ ...base, ...body }).success).toBe(false);
  });
});
