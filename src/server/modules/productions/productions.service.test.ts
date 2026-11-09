import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishProductionBodySchema } from "./productions.schemas";
import { finishProduction, previewLeftovers } from "./productions.service";

const repository = vi.hoisted(() => ({
  consumeProductionInput: vi.fn(),
  discardLeftover: vi.fn(),
  findProductionById: vi.fn(),
  inProductionTransaction: vi.fn(),
  insertProduction: vi.fn(),
  listProductions: vi.fn(),
  markProductionCanceled: vi.fn(),
  markProductionFinished: vi.fn(),
  outputProductionItem: vi.fn(),
  previewProductionLeftovers: vi.fn(),
  releasePreWeighings: vi.fn(),
}));

vi.mock("./productions.repository", () => repository);
vi.mock("@/server/modules/stock/stock.repository", () => ({ holdStockBalances: vi.fn() }));
vi.mock("@/server/modules/pre-weighings/pre-weighings.repository", () => ({ findPreWeighingById: vi.fn() }));
vi.mock("@/server/modules/pre-weighings/pre-weighings.service", () => ({ planPreWeighing: vi.fn() }));

const D = (value: string) => new Prisma.Decimal(value);
const ITEM = "018f0000-0000-7000-8000-0000000000b1";
const MILK = { sku: "sku-milk", description: "Leite condensado", unit: "GRAM", isStorableOnceOpened: false };

const FLAN_ITEM = "018f0000-0000-7000-8000-0000000000b2";

const itemOf = (id: string, description: string, inputId: string, storable = false) => ({
  id,
  product: { sku: `sku-${description}`, description, unit: "KILOGRAM" },
  preWeighingId: null,
  expectedQuantity: D("1"),
  producedQuantity: null,
  unitCost: null,
  inputs: [
    {
      id: inputId,
      quantity: D("300"),
      unitCost: null,
      product: { ...MILK, isStorableOnceOpened: storable },
      leftovers: [],
    },
  ],
});

const production = (
  status: "IN_PROGRESS" | "FINISHED" = "IN_PROGRESS",
  items = [itemOf(ITEM, "Pudim", "input-1")],
) => ({
  id: "production-1",
  status,
  createdAt: new Date("2026-11-09T12:00:00Z"),
  finishedAt: null,
  canceledAt: null,
  hasLeftoversInCost: null,
  items,
});

// What taking `taken` from the can lot leaves, the lot holding `lotQuantity` before the take.
const consumed = (taken: string, lotQuantity: string) => ({
  cost: D(taken).mul("0.02"),
  takes: [
    { lotId: "lot-1", quantity: D(taken), unitCost: D("0.02"), lotQuantity: D(lotQuantity), packageContent: D("395") },
  ],
});

const finish = (hasLeftoversInCost?: boolean, items = [{ id: ITEM, producedQuantity: "1", expiresAt: null }]) =>
  finishProduction({
    id: "production-1",
    createdById: "user-1",
    items,
    ...(hasLeftoversInCost === undefined ? {} : { hasLeftoversInCost }),
  });

const discarded = () =>
  repository.discardLeftover.mock.calls.map(([, call]) => [call.inputId, call.lotId, call.quantity.toString()]);

const unitCostOf = (itemId: string) =>
  repository.outputProductionItem.mock.calls.find(([, call]) => call.id === itemId)![1].unitCost.toString();

beforeEach(() => {
  vi.clearAllMocks();
  repository.findProductionById.mockResolvedValue(production());
  repository.inProductionTransaction.mockImplementation((work: (tx: object) => unknown) => work({}));
  repository.markProductionFinished.mockResolvedValue(true);
  repository.consumeProductionInput.mockResolvedValue(consumed("300", "3950"));
});

describe("finishProduction, leftovers of opened packagings", () => {
  it("discards what is left of the opened can, and adds its cost when asked", async () => {
    await finish(true);

    expect(discarded()).toEqual([["input-1", "lot-1", "95"]]);
    expect(unitCostOf(ITEM)).toBe("7.9");
    expect(repository.markProductionFinished).toHaveBeenCalledWith({}, "production-1", true);
  });

  it("keeps the leftover out of the cost when asked to", async () => {
    await finish(false);

    expect(discarded()).toEqual([["input-1", "lot-1", "95"]]);
    expect(unitCostOf(ITEM)).toBe("6");
    expect(repository.markProductionFinished).toHaveBeenCalledWith({}, "production-1", false);
  });

  it("does not discard what can be kept once opened", async () => {
    repository.findProductionById.mockResolvedValue(
      production("IN_PROGRESS", [itemOf(ITEM, "Pudim", "input-1", true)]),
    );

    await finish(true);

    expect(repository.discardLeftover).not.toHaveBeenCalled();
  });

  it("lets the items of a production share an opened can, splitting what is left by what each took", async () => {
    repository.findProductionById.mockResolvedValue(
      production("IN_PROGRESS", [itemOf(ITEM, "Pudim", "input-1"), itemOf(FLAN_ITEM, "Flan", "input-2")]),
    );
    repository.consumeProductionInput
      .mockResolvedValueOnce(consumed("100", "3950"))
      .mockResolvedValueOnce(consumed("100", "3850"));

    await finish(true, [
      { id: ITEM, producedQuantity: "1", expiresAt: null },
      { id: FLAN_ITEM, producedQuantity: "1", expiresAt: null },
    ]);

    // One can opened for 200 g: 195 g left, half for each.
    expect(discarded()).toEqual([
      ["input-1", "lot-1", "97.5"],
      ["input-2", "lot-1", "97.5"],
    ]);
    expect(unitCostOf(ITEM)).toBe("3.95");
    expect(unitCostOf(FLAN_ITEM)).toBe("3.95");
  });

  it("counts the leftover in the cost when the body does not say", () => {
    expect(
      finishProductionBodySchema.parse({ items: [{ id: ITEM, producedQuantity: "1", expiresAt: null }] }),
    ).toMatchObject({ hasLeftoversInCost: true });
  });
});

describe("previewLeftovers", () => {
  it("answers 404 for a production that does not exist", async () => {
    repository.findProductionById.mockResolvedValue(null);

    expect(await previewLeftovers("production-1")).toMatchObject({ ok: false, status: 404 });
  });

  it("answers 409 for a production no longer in progress", async () => {
    repository.findProductionById.mockResolvedValue(production("FINISHED"));

    expect(await previewLeftovers("production-1")).toMatchObject({ ok: false, status: 409 });
  });

  it("prices each leftover and sums them", async () => {
    repository.previewProductionLeftovers.mockResolvedValue([
      { itemId: ITEM, leftovers: [{ product: MILK, lotId: "lot-1", quantity: D("95"), unitCost: D("0.02") }] },
    ]);

    const result = await previewLeftovers("production-1");

    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          {
            itemId: ITEM,
            leftovers: [
              {
                product: { sku: "sku-milk", description: "Leite condensado", unit: "GRAM" },
                lotId: "lot-1",
                quantity: "95",
                unitCost: "0.02",
                cost: "1.90",
              },
            ],
          },
        ],
        totalCost: "1.90",
      },
    });
  });
});
