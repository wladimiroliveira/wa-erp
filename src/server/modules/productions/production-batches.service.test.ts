import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { concludeItem, weighItem } from "./production-batches.service";
import { concludeItemBodySchema } from "./productions.schemas";

const repository = vi.hoisted(() => ({
  closeIfResolved: vi.fn(),
  consumeProductionInput: vi.fn(),
  discardLeftover: vi.fn(),
  enterProducedLot: vi.fn(),
  findProductionById: vi.fn(),
  inProductionTransaction: vi.fn(),
  lockProductionInProgress: vi.fn(),
  markItemConcluded: vi.fn(),
}));

vi.mock("./productions.repository", () => repository);
// No intermediate in these productions, and no average cost for what already existed.
vi.mock("@/server/modules/stock/stock.repository", () => ({ holdStockBalances: vi.fn(async () => []) }));
const preWeighingService = vi.hoisted(() => ({ preparePreWeighing: vi.fn() }));

vi.mock("@/server/modules/pre-weighings/pre-weighings.service", () => preWeighingService);

const ITEM = "018f0000-0000-7000-8000-0000000000b1";

const filling = {
  id: ITEM,
  status: "PENDING",
  product: { sku: "sku-filling", description: "Recheio", unit: "KILOGRAM" },
  preWeighingId: null,
  expectedQuantity: new Prisma.Decimal("1"),
  damages: [],
  batches: [],
  extraWeighings: [],
  inputs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  repository.findProductionById.mockResolvedValue({ id: "production-1", status: "IN_PROGRESS", items: [filling] });
});

describe("weighItem", () => {
  it("plans the item's recipe without stages before it holds the production, and holds nothing for a plan refused", async () => {
    const refused = { ok: false, status: 409, message: "The items do not match the ingredients of the recipe." };
    preWeighingService.preparePreWeighing.mockResolvedValue(refused);
    const items = [{ productSku: "sku-milk", weighedQuantity: "0.24" }];

    const result = await weighItem({
      productionId: "production-1",
      itemId: ITEM,
      quantity: "0.3",
      items,
      createdById: "user-1",
    });

    expect(result).toEqual(refused);
    expect(preWeighingService.preparePreWeighing).toHaveBeenCalledWith({
      productSku: "sku-filling",
      quantity: "0.3",
      items,
      stages: [],
    });
    expect(repository.inProductionTransaction).not.toHaveBeenCalled();
  });

  it("answers 404 for a production or an item it does not have, before planning", async () => {
    const missingItem = await weighItem({
      productionId: "production-1",
      itemId: "018f0000-0000-7000-8000-0000000000ff",
      quantity: "0.3",
      items: [],
      createdById: "user-1",
    });
    repository.findProductionById.mockResolvedValue(null);
    const missingProduction = await weighItem({
      productionId: "production-1",
      itemId: ITEM,
      quantity: "0.3",
      items: [],
      createdById: "user-1",
    });

    expect(missingItem).toEqual({ ok: false, status: 404, message: "Production item not found." });
    expect(missingProduction).toEqual({ ok: false, status: 404, message: "Production not found." });
    expect(preWeighingService.preparePreWeighing).not.toHaveBeenCalled();
  });
});

const D = (value: string) => new Prisma.Decimal(value);
const PUDDING = "018f0000-0000-7000-8000-0000000000b2";
const MILK = {
  sku: "sku-milk",
  description: "Leite condensado",
  unit: "GRAM",
  kind: "GOODS",
  isStorableOnceOpened: false,
};

// A pudding of 1 kg made in one batch, out of 300 g of condensed milk.
const pudding = ({ storable = false, milk = "300" } = {}) => ({
  ...filling,
  id: PUDDING,
  finishedAt: null,
  hasLeftoversInCost: null,
  substitutedAt: null,
  preWeighing: null,
  producedQuantity: null,
  unitCost: null,
  product: { sku: "sku-pudding", description: "Pudim", unit: "KILOGRAM" },
  batches: [{ id: "batch-1", quantity: D("1"), expiresAt: null, source: "PRODUCED", createdAt: new Date() }],
  inputs: [
    {
      id: "input-1",
      quantity: D(milk),
      unitCost: null,
      product: { ...MILK, isStorableOnceOpened: storable },
      leftovers: [],
    },
  ],
});

// The production as presented after the conclusion: these tests read what was moved, not the answer.
const held = (item = pudding()) => ({
  id: "production-1",
  status: "IN_PROGRESS",
  createdAt: new Date("2026-11-24T12:00:00Z"),
  finishedAt: null,
  canceledAt: null,
  items: [item],
});

// What taking `taken` from a lot of cans of 395 g at 0.02 a gram leaves, the lot holding 3950 g.
const consumed = (taken: string) => ({
  cost: D(taken).mul("0.02"),
  takes: [
    { lotId: "lot-1", quantity: D(taken), unitCost: D("0.02"), lotQuantity: D("3950"), packageContent: D("395") },
  ],
});

const conclude = (hasLeftoversInCost = true) =>
  concludeItem({
    productionId: "production-1",
    itemId: PUDDING,
    belowTarget: false,
    hasLeftoversInCost,
    createdById: "user-1",
  });

const discarded = () =>
  repository.discardLeftover.mock.calls.map(([, call]) => [call.inputId, call.lotId, call.quantity.toString()]);

const enteredCost = () => repository.enterProducedLot.mock.calls[0]![1].unitCost.toString();

describe("concludeItem, leftovers of opened packagings", () => {
  beforeEach(() => {
    repository.findProductionById.mockResolvedValue(held());
    repository.inProductionTransaction.mockImplementation((work: (tx: object) => unknown) => work({}));
    repository.lockProductionInProgress.mockResolvedValue(true);
    repository.consumeProductionInput.mockResolvedValue(consumed("300"));
  });

  it("discards what is left of the opened can, and adds its cost when asked", async () => {
    expect(await conclude(true)).toMatchObject({ ok: true });

    expect(discarded()).toEqual([["input-1", "lot-1", "95"]]);
    expect(enteredCost()).toBe("7.9");
    expect(repository.markItemConcluded).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: PUDDING, hasLeftoversInCost: true }),
    );
  });

  it("keeps the leftover out of the cost when asked to", async () => {
    await conclude(false);

    expect(discarded()).toEqual([["input-1", "lot-1", "95"]]);
    expect(enteredCost()).toBe("6");
    expect(repository.markItemConcluded).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: PUDDING, hasLeftoversInCost: false }),
    );
  });

  it("does not discard what can be kept once opened", async () => {
    repository.findProductionById.mockResolvedValue(held(pudding({ storable: true })));

    await conclude();

    expect(repository.discardLeftover).not.toHaveBeenCalled();
  });

  it("discards nothing of what was taken beyond the lots, and still counts what it cost", async () => {
    repository.consumeProductionInput.mockResolvedValue({
      cost: D("6"),
      takes: [{ lotId: null, quantity: D("300"), unitCost: D("0.02"), lotQuantity: null, packageContent: null }],
    });

    await conclude();

    expect(repository.discardLeftover).not.toHaveBeenCalled();
    expect(enteredCost()).toBe("6");
  });

  it("closes the production once the item is concluded", async () => {
    await conclude();

    expect(repository.closeIfResolved).toHaveBeenCalledWith({}, "production-1");
  });

  it("takes what the production holds once it is held, not what it held before", async () => {
    repository.findProductionById.mockImplementation(async (_id: string, tx?: object) =>
      tx === undefined ? held() : held(pudding({ milk: "240" })),
    );
    repository.consumeProductionInput.mockResolvedValue(consumed("240"));

    await conclude();

    expect(repository.consumeProductionInput.mock.calls[0]![1]).toMatchObject({ quantity: D("240") });
  });
});

describe("concludeItemBodySchema", () => {
  it("counts the leftovers in the cost and takes the target as meant to be reached when the body does not say", () => {
    expect(concludeItemBodySchema.parse({})).toEqual({ belowTarget: false, hasLeftoversInCost: true });
  });
});
