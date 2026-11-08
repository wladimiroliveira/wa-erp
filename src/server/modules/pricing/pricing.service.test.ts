import { Prisma, ProductKind } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markupPercentSchema } from "./pricing.schemas";
import { listPricing, setMarkup } from "./pricing.service";

const repository = vi.hoisted(() => ({
  findPricingSources: vi.fn(),
  findProductKind: vi.fn(),
  upsertMarkup: vi.fn(),
}));

vi.mock("./pricing.repository", () => repository);

const BREAD = { sku: "018f0000-0000-7000-8000-000000000090", description: "Pão francês", unit: "UNIT" as const };
const FLOUR = { sku: "018f0000-0000-7000-8000-000000000010", description: "Farinha", unit: "KILOGRAM" as const };
const BUTTER = { sku: "018f0000-0000-7000-8000-000000000011", description: "Manteiga", unit: "KILOGRAM" as const };
const DOUGH = { sku: "018f0000-0000-7000-8000-000000000012", description: "Massa base", unit: "KILOGRAM" as const };

const ingredient = (product: typeof FLOUR, quantity: string, averageCost: string | null | undefined) => ({
  quantity: new Prisma.Decimal(quantity),
  product: {
    ...product,
    stock:
      averageCost === undefined ? null : { averageCost: averageCost === null ? null : new Prisma.Decimal(averageCost) },
  },
});

function aSource(
  over: { markup?: string | null; ingredients?: ReturnType<typeof ingredient>[]; yieldQuantity?: string } = {},
) {
  const markup = over.markup === undefined ? "35.00" : over.markup;

  return {
    yieldQuantity: new Prisma.Decimal(over.yieldQuantity ?? "10"),
    product: { ...BREAD, markup: markup === null ? null : { markupPercent: new Prisma.Decimal(markup) } },
    ingredients: over.ingredients ?? [ingredient(FLOUR, "2", "5.5"), ingredient(BUTTER, "0.5", "8")],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPricing", () => {
  it("marks a row priced when cost is complete and a markup exists", async () => {
    repository.findPricingSources.mockResolvedValue([aSource()]);

    const [row] = await listPricing();

    expect(row).toMatchObject({
      product: BREAD,
      yieldQuantity: "10",
      status: "priced",
      costPerUnit: "1.500000",
      markupPercent: "35.00",
      pricePerUnit: "2.03",
    });
    expect(row?.ingredients).toEqual([
      { product: FLOUR, quantity: "2", averageCost: "5.5", subtotal: "11.000000" },
      { product: BUTTER, quantity: "0.5", averageCost: "8", subtotal: "4.000000" },
    ]);
  });

  it("marks a row no-markup with cost and a null price", async () => {
    repository.findPricingSources.mockResolvedValue([aSource({ markup: null })]);

    expect((await listPricing())[0]).toMatchObject({
      status: "no-markup",
      costPerUnit: "1.500000",
      markupPercent: null,
      pricePerUnit: null,
    });
  });

  it("marks a row incomplete-cost with null cost and price, and null subtotal on the missing ingredient", async () => {
    repository.findPricingSources.mockResolvedValue([
      aSource({ ingredients: [ingredient(FLOUR, "2", "5.5"), ingredient(BUTTER, "0.5", null)] }),
    ]);

    const [row] = await listPricing();

    expect(row).toMatchObject({
      status: "incomplete-cost",
      costPerUnit: null,
      markupPercent: "35.00",
      pricePerUnit: null,
    });
    expect(row?.ingredients[1]).toEqual({ product: BUTTER, quantity: "0.5", averageCost: null, subtotal: null });
  });

  it("treats a missing stock row as missing cost", async () => {
    repository.findPricingSources.mockResolvedValue([
      aSource({ ingredients: [ingredient(FLOUR, "2", "5.5"), ingredient(BUTTER, "0.5", undefined)] }),
    ]);

    expect((await listPricing())[0]?.status).toBe("incomplete-cost");
  });

  it("costs a manufactured ingredient by its stock average cost", async () => {
    repository.findPricingSources.mockResolvedValue([
      aSource({ yieldQuantity: "1", markup: "0", ingredients: [ingredient(DOUGH, "1", "3")] }),
    ]);

    expect((await listPricing())[0]).toMatchObject({ costPerUnit: "3.000000", pricePerUnit: "3.00" });
  });
});

describe("setMarkup", () => {
  const USER_ID = "018f0000-0000-7000-8000-000000000001";

  it("answers 404 for an unknown product", async () => {
    repository.findProductKind.mockResolvedValue(null);

    expect(await setMarkup(USER_ID, { productSku: BREAD.sku, markupPercent: "35" })).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(repository.upsertMarkup).not.toHaveBeenCalled();
  });

  it("answers 409 for a resale product", async () => {
    repository.findProductKind.mockResolvedValue(ProductKind.GOODS);

    expect(await setMarkup(USER_ID, { productSku: BREAD.sku, markupPercent: "35" })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(repository.upsertMarkup).not.toHaveBeenCalled();
  });

  it("upserts with the user as updatedById and returns the stored markup", async () => {
    repository.findProductKind.mockResolvedValue(ProductKind.MANUFACTURED);
    repository.upsertMarkup.mockResolvedValue({ markupPercent: new Prisma.Decimal("35.5") });

    expect(await setMarkup(USER_ID, { productSku: BREAD.sku, markupPercent: "35.5" })).toEqual({
      ok: true,
      data: { markupPercent: "35.50" },
    });
    expect(repository.upsertMarkup).toHaveBeenCalledWith({
      productSku: BREAD.sku,
      markupPercent: "35.5",
      updatedById: USER_ID,
    });
  });
});

describe("markupPercentSchema", () => {
  it.each(["0", "1000", "12.5", "35.00"])("accepts %s", (value) => {
    expect(markupPercentSchema.safeParse(value).success).toBe(true);
  });

  it.each(["1000.01", "1.234", "-1", "abc", ""])("refuses %s", (value) => {
    expect(markupPercentSchema.safeParse(value).success).toBe(false);
  });
});
