import { Prisma, ProductKind } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markupPercentSchema } from "./pricing.schemas";
import { listPricing, repriceProduct, setMarkup } from "./pricing.service";

const repository = vi.hoisted(() => ({
  findPricingSources: vi.fn(),
  findProductKind: vi.fn(),
  upsertMarkup: vi.fn(),
  findPricingInputs: vi.fn(),
  insertPrice: vi.fn(),
  findCurrentPrice: vi.fn(),
}));
const stock = vi.hoisted(() => ({ onHandUnitCost: vi.fn(), lockStockBalance: vi.fn() }));
const db = vi.hoisted(() => {
  const tx = {};

  return { tx, prisma: { $transaction: vi.fn((run: (client: unknown) => unknown) => run(tx)) } };
});

vi.mock("./pricing.repository", () => repository);
vi.mock("@/server/modules/stock/stock.repository", () => stock);
vi.mock("@/server/lib/prisma", () => ({ prisma: db.prisma }));

const BREAD = { sku: "018f0000-0000-7000-8000-000000000090", description: "Pão francês", unit: "UNIT" as const };
const aPrice = (price: string, averageCost: string, markupPercent: string, createdAt: string) => ({
  price: new Prisma.Decimal(price),
  averageCost: new Prisma.Decimal(averageCost),
  markupPercent: new Prisma.Decimal(markupPercent),
  createdAt: new Date(createdAt),
});

function aSource(over: { markup?: string | null; prices?: ReturnType<typeof aPrice>[] } = {}) {
  const markup = over.markup === undefined ? "35.00" : over.markup;

  return {
    ...BREAD,
    markup: markup === null ? null : { markupPercent: new Prisma.Decimal(markup) },
    prices: over.prices ?? [aPrice("2.03", "1.5", "35", "2026-11-20T12:00:00.000Z")],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPricing", () => {
  it("marks a row priced with its current price, on-hand cost and history", async () => {
    repository.findPricingSources.mockResolvedValue([
      aSource({
        prices: [
          aPrice("2.03", "1.5", "35", "2026-11-20T12:00:00.000Z"),
          aPrice("1.80", "1.333333", "35", "2026-11-10T12:00:00.000Z"),
        ],
      }),
    ]);
    stock.onHandUnitCost.mockResolvedValue(new Prisma.Decimal("1.6"));

    const [row] = await listPricing();

    expect(stock.onHandUnitCost).toHaveBeenCalledWith(expect.anything(), {
      productSku: BREAD.sku,
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(row).toEqual({
      product: BREAD,
      status: "priced",
      markupPercent: "35.00",
      onHandCost: "1.6",
      currentPrice: {
        price: "2.03",
        averageCost: "1.5",
        markupPercent: "35.00",
        createdAt: "2026-11-20T12:00:00.000Z",
      },
      history: [
        { price: "2.03", averageCost: "1.5", markupPercent: "35.00", createdAt: "2026-11-20T12:00:00.000Z" },
        { price: "1.80", averageCost: "1.333333", markupPercent: "35.00", createdAt: "2026-11-10T12:00:00.000Z" },
      ],
    });
  });

  it("marks a row no-markup when there is no markup, even with a price", async () => {
    repository.findPricingSources.mockResolvedValue([aSource({ markup: null })]);
    stock.onHandUnitCost.mockResolvedValue(null);

    expect((await listPricing())[0]).toMatchObject({ status: "no-markup", markupPercent: null, onHandCost: null });
  });

  it("marks a row no-price when there is a markup but no price", async () => {
    repository.findPricingSources.mockResolvedValue([aSource({ prices: [] })]);
    stock.onHandUnitCost.mockResolvedValue(new Prisma.Decimal("2"));

    expect((await listPricing())[0]).toMatchObject({
      status: "no-price",
      markupPercent: "35.00",
      onHandCost: "2",
      currentPrice: null,
      history: [],
    });
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

describe("setMarkup pricing", () => {
  const USER_ID = "018f0000-0000-7000-8000-000000000001";

  beforeEach(() => {
    repository.findProductKind.mockResolvedValue(ProductKind.MANUFACTURED);
    repository.upsertMarkup.mockResolvedValue({ markupPercent: new Prisma.Decimal("50") });
    repository.findPricingInputs.mockResolvedValue({
      kind: ProductKind.MANUFACTURED,
      markupPercent: new Prisma.Decimal("50"),
    });
    stock.onHandUnitCost.mockResolvedValue(new Prisma.Decimal("9.2"));
  });

  it("writes no price when one exists already", async () => {
    repository.findCurrentPrice.mockResolvedValue({ price: new Prisma.Decimal("1") });

    await setMarkup(USER_ID, { productSku: BREAD.sku, markupPercent: "50" });

    expect(repository.insertPrice).not.toHaveBeenCalled();
  });

  it("holds the product balance before it looks for a price, inside the transaction", async () => {
    repository.findCurrentPrice.mockResolvedValue(null);

    await setMarkup(USER_ID, { productSku: BREAD.sku, markupPercent: "50" });

    expect(stock.lockStockBalance).toHaveBeenCalledWith(db.tx, BREAD.sku);
    expect(repository.findCurrentPrice).toHaveBeenCalledWith(db.tx, BREAD.sku);
    expect(stock.lockStockBalance.mock.invocationCallOrder[0]).toBeLessThan(
      repository.findCurrentPrice.mock.invocationCallOrder[0] as number,
    );
  });

  it("writes the first price when there is none", async () => {
    repository.findCurrentPrice.mockResolvedValue(null);

    await setMarkup(USER_ID, { productSku: BREAD.sku, markupPercent: "50" });

    expect(repository.insertPrice).toHaveBeenCalledTimes(1);
  });
});

describe("repriceProduct", () => {
  const tx = db.tx as never;
  const today = "2026-11-27";

  const priced = (kind: ProductKind, markup: string | null, basis: string | null) => {
    repository.findPricingInputs.mockResolvedValue({
      kind,
      markupPercent: markup === null ? null : new Prisma.Decimal(markup),
    });
    stock.onHandUnitCost.mockResolvedValue(basis === null ? null : new Prisma.Decimal(basis));
  };

  it("inserts the price on the cost of what is on hand", async () => {
    priced(ProductKind.MANUFACTURED, "50.00", "9.2");

    await repriceProduct(tx, { productSku: BREAD.sku, today });

    expect(stock.onHandUnitCost).toHaveBeenCalledWith(tx, { productSku: BREAD.sku, today });
    expect(repository.insertPrice).toHaveBeenCalledWith(tx, {
      productSku: BREAD.sku,
      averageCost: "9.2",
      markupPercent: "50.00",
      price: "13.80",
    });
  });

  it("does nothing for a resale product", async () => {
    priced(ProductKind.GOODS, "50.00", "9.2");

    await repriceProduct(tx, { productSku: BREAD.sku, today });

    expect(repository.insertPrice).not.toHaveBeenCalled();
  });

  it("does nothing without a markup", async () => {
    priced(ProductKind.MANUFACTURED, null, "9.2");

    await repriceProduct(tx, { productSku: BREAD.sku, today });

    expect(repository.insertPrice).not.toHaveBeenCalled();
  });

  it("does nothing without a cost on hand", async () => {
    priced(ProductKind.MANUFACTURED, "50.00", null);

    await repriceProduct(tx, { productSku: BREAD.sku, today });

    expect(repository.insertPrice).not.toHaveBeenCalled();
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
