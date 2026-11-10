import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preWeighingPlanQuerySchema } from "./pre-weighings.schemas";
import { previewPreWeighing } from "./pre-weighings.service";

const repository = vi.hoisted(() => ({
  findProductWithRecipe: vi.fn(),
  findPreWeighingById: vi.fn(),
  insertPreWeighing: vi.fn(),
  listPreWeighings: vi.fn(),
}));
const stock = vi.hoisted(() => ({ suggestLots: vi.fn() }));

vi.mock("./pre-weighings.repository", () => repository);
vi.mock("@/server/modules/stock/stock.repository", () => stock);

const D = (value: string) => new Prisma.Decimal(value);

const ingredient = (
  sku: string,
  description: string,
  quantity: string,
  { storable = true, averageCost = "0.02" as string | null, unit = "GRAM" } = {},
) => ({
  quantity: D(quantity),
  product: {
    sku,
    description,
    unit,
    isActive: true,
    isStorableOnceOpened: storable,
    stock: averageCost === null ? null : { averageCost: D(averageCost) },
  },
});

const PUDDING = (ingredients: ReturnType<typeof ingredient>[]) => ({
  sku: "sku-pudding",
  description: "Pudim",
  unit: "KILOGRAM",
  isActive: true,
  recipe: { yieldQuantity: D("1"), ingredients },
});

const lotIn = (content: string | null) => ({
  takes: [
    {
      lot: {
        id: "lot-1",
        quantity: D("10000"),
        unitCost: D("0.02"),
        expiresAt: null,
        createdAt: new Date(),
        packageContent: content === null ? null : D(content),
      },
      quantity: D("1"),
    },
  ],
  shortfall: D("0"),
});

beforeEach(() => {
  vi.clearAllMocks();
  stock.suggestLots.mockResolvedValue(lotIn("395"));
});

const waste = async (tolerance = 20) => {
  const result = await previewPreWeighing("sku-pudding", "10", tolerance);

  if (!result.ok) throw new Error(result.message);

  return result.data.waste;
};

describe("previewPreWeighing, waste", () => {
  it("says nothing of waste when every ingredient keeps once opened", async () => {
    repository.findProductWithRecipe.mockResolvedValue(PUDDING([ingredient("sku-sugar", "Açúcar", "300")]));

    expect(await waste()).toBeNull();
  });

  it("prices the leftover of a can that cannot be kept, and offers the quantity that closes it", async () => {
    repository.findProductWithRecipe.mockResolvedValue(
      PUDDING([ingredient("sku-milk", "Leite condensado", "300", { storable: false })]),
    );

    const found = await waste();

    expect(found).toMatchObject({
      tolerance: 20,
      requested: {
        quantity: "10",
        loss: "3.20",
        leftovers: [
          {
            product: { sku: "sku-milk", description: "Leite condensado", unit: "GRAM" },
            leftover: "160",
            loss: "3.20",
          },
        ],
      },
      unpackaged: [],
      uncosted: [],
    });
    expect(found!.alternatives[0]).toMatchObject({ quantity: "10.533", loss: "0.00" });
  });

  it("leaves out, and names, an ingredient whose first lot came in loose or that has no lot", async () => {
    repository.findProductWithRecipe.mockResolvedValue(
      PUDDING([
        ingredient("sku-milk", "Leite condensado", "300", { storable: false }),
        ingredient("sku-cream", "Creme de leite", "250", { storable: false, unit: "MILLILITER" }),
      ]),
    );
    stock.suggestLots.mockResolvedValueOnce(lotIn(null)).mockResolvedValueOnce({ takes: [], shortfall: D("2500") });

    const found = await waste();

    expect(found!.unpackaged.map(({ sku }) => sku)).toEqual(["sku-milk", "sku-cream"]);
    expect(found!.requested).toEqual({ quantity: "10", loss: "0.00", leftovers: [] });
  });

  it("names a counted ingredient with no average cost, and leaves its leftover unpriced", async () => {
    repository.findProductWithRecipe.mockResolvedValue(
      PUDDING([ingredient("sku-milk", "Leite condensado", "300", { storable: false, averageCost: null })]),
    );

    const found = await waste();

    expect(found!.uncosted.map(({ sku }) => sku)).toEqual(["sku-milk"]);
    expect(found!.requested.leftovers).toEqual([expect.objectContaining({ leftover: "160", loss: null })]);
  });
});

describe("preWeighingPlanQuerySchema tolerance", () => {
  const target = { productSku: "018f0000-0000-7000-8000-000000000090", quantity: "10" };

  it("defaults to 20 percent", () => expect(preWeighingPlanQuerySchema.parse(target).tolerance).toBe(20));

  it("takes a tolerance left empty in the query string as the default, not as zero", () =>
    expect(preWeighingPlanQuerySchema.parse({ ...target, tolerance: "" }).tolerance).toBe(20));

  it("takes a whole percent from the query string", () =>
    expect(preWeighingPlanQuerySchema.parse({ ...target, tolerance: "35" }).tolerance).toBe(35));

  it.each(["101", "-1", "1.5", "abc"])("refuses %s", (tolerance) =>
    expect(preWeighingPlanQuerySchema.safeParse({ ...target, tolerance }).success).toBe(false),
  );
});
