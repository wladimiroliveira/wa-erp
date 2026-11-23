import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishProductionBodySchema } from "./productions.schemas";
import {
  finishProduction,
  itemFromPreWeighing,
  previewLeftovers,
  recordProductionWeighing,
  reduceProductionItem,
  startProduction,
} from "./productions.service";

const repository = vi.hoisted(() => ({
  closeIfResolved: vi.fn(),
  consumeProductionInput: vi.fn(),
  discardLeftover: vi.fn(),
  findProductionById: vi.fn(),
  inProductionTransaction: vi.fn(),
  insertProduction: vi.fn(),
  listProductions: vi.fn(),
  lockProductionInProgress: vi.fn(),
  markProductionCanceled: vi.fn(),
  outputProductionItem: vi.fn(),
  previewProductionLeftovers: vi.fn(),
  releasePreWeighings: vi.fn(),
  rescaleProductionItem: vi.fn(),
}));

vi.mock("./productions.repository", () => repository);
// No intermediate in these productions: no balance is checked.
vi.mock("@/server/modules/stock/stock.repository", () => ({ holdStockBalances: vi.fn(async () => []) }));
const preWeighings = vi.hoisted(() => ({ findPreWeighingTree: vi.fn(), isPendingStartRoot: vi.fn() }));

vi.mock("@/server/modules/pre-weighings/pre-weighings.repository", () => preWeighings);
const preWeighingService = vi.hoisted(() => ({ planPreWeighing: vi.fn(), preparePreWeighing: vi.fn() }));

vi.mock("@/server/modules/pre-weighings/pre-weighings.service", () => preWeighingService);

const D = (value: string) => new Prisma.Decimal(value);
const ITEM = "018f0000-0000-7000-8000-0000000000b1";
const MILK = { sku: "sku-milk", description: "Leite condensado", unit: "GRAM", isStorableOnceOpened: false };

const FLAN_ITEM = "018f0000-0000-7000-8000-0000000000b2";

// A damage as the repository reads it; only the pre-weighing it took away matters to these tests.
const damageOf = (preWeighingId: string | null) => ({
  id: "018f0000-0000-7000-8000-0000000000d1",
  preWeighingId,
  note: null,
  createdAt: new Date("2026-11-09T13:00:00Z"),
  reason: { id: "018f0000-0000-7000-8000-0000000000e1", name: "Queimou" },
});

const itemOf = (id: string, description: string, inputId: string, storable = false) => ({
  id,
  status: "PENDING" as "PENDING" | "FINISHED" | "SUBSTITUTED",
  finishedAt: null,
  hasLeftoversInCost: null,
  damages: [] as ReturnType<typeof damageOf>[],
  product: { sku: `sku-${description}`, description, unit: "KILOGRAM" },
  preWeighingId: null as string | null,
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
  repository.lockProductionInProgress.mockResolvedValue(true);
  repository.consumeProductionInput.mockResolvedValue(consumed("300", "3950"));
});

describe("finishProduction, leftovers of opened packagings", () => {
  it("discards what is left of the opened can, and adds its cost when asked", async () => {
    await finish(true);

    expect(discarded()).toEqual([["input-1", "lot-1", "95"]]);
    expect(unitCostOf(ITEM)).toBe("7.9");
    expect(repository.outputProductionItem).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: ITEM, hasLeftoversInCost: true }),
    );
  });

  it("keeps the leftover out of the cost when asked to", async () => {
    await finish(false);

    expect(discarded()).toEqual([["input-1", "lot-1", "95"]]);
    expect(unitCostOf(ITEM)).toBe("6");
    expect(repository.outputProductionItem).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: ITEM, hasLeftoversInCost: false }),
    );
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

  it("discards nothing of what was taken beyond the lots, and still counts what it cost", async () => {
    repository.consumeProductionInput.mockResolvedValue({
      cost: D("6"),
      takes: [{ lotId: null, quantity: D("300"), unitCost: D("0.02"), lotQuantity: null, packageContent: null }],
    });

    await finish(true);

    expect(repository.discardLeftover).not.toHaveBeenCalled();
    expect(unitCostOf(ITEM)).toBe("6");
  });

  it("counts the leftover in the cost when the body does not say", () => {
    expect(
      finishProductionBodySchema.parse({ items: [{ id: ITEM, producedQuantity: "1", expiresAt: null }] }),
    ).toMatchObject({ hasLeftoversInCost: true });
  });
});

describe("finishProduction, a subset of the items", () => {
  const pending = () => itemOf(ITEM, "Pudim", "input-1");
  const finished = () => ({ ...itemOf(FLAN_ITEM, "Flan", "input-2"), status: "FINISHED" as const });

  it("closes the production once the items are finished", async () => {
    await finish(true);

    expect(repository.closeIfResolved).toHaveBeenCalledWith({}, "production-1");
  });

  it("refuses an id not of the production before an item not pending", async () => {
    repository.findProductionById.mockResolvedValue(production("IN_PROGRESS", [pending(), finished()]));

    const result = await finish(true, [
      { id: FLAN_ITEM, producedQuantity: "1", expiresAt: null },
      { id: "018f0000-0000-7000-8000-0000000000ff", producedQuantity: "1", expiresAt: null },
    ]);

    expect(result).toEqual({ ok: false, status: 409, message: "The items do not match the items of the production." });
    expect(repository.consumeProductionInput).not.toHaveBeenCalled();
    expect(repository.closeIfResolved).not.toHaveBeenCalled();
  });

  it("refuses an item not pending before one that waits for a new weighing", async () => {
    const awaiting = { ...pending(), damages: [damageOf("pre-weighing-1")] };
    repository.findProductionById.mockResolvedValue(production("IN_PROGRESS", [awaiting, finished()]));

    expect(
      await finish(true, [
        { id: ITEM, producedQuantity: "1", expiresAt: null },
        { id: FLAN_ITEM, producedQuantity: "1", expiresAt: null },
      ]),
    ).toEqual({ ok: false, status: 409, message: "The item is not pending." });
    expect(await finish(true)).toEqual({ ok: false, status: 409, message: "The item waits for a new weighing." });
    expect(repository.consumeProductionInput).not.toHaveBeenCalled();
  });

  it("lets a free item damaged before be made again", async () => {
    repository.findProductionById.mockResolvedValue(
      production("IN_PROGRESS", [{ ...pending(), damages: [damageOf(null)] }]),
    );

    expect(await finish(true)).toMatchObject({ ok: true });
  });

  it("answers 404 for a production that does not exist, and 409 for one not in progress", async () => {
    repository.lockProductionInProgress.mockResolvedValue(false);
    repository.findProductionById.mockResolvedValue(null);

    expect(await finish(true)).toMatchObject({ ok: false, status: 404 });

    repository.findProductionById.mockResolvedValue(production("FINISHED"));

    expect(await finish(true)).toEqual({ ok: false, status: 409, message: "Production is not in progress." });
  });
});

describe("finishProduction, a production changed while it waited", () => {
  it("takes what the production holds once it is held, not what it held when asked for", async () => {
    const reduced = itemOf(ITEM, "Pudim", "input-1");
    reduced.expectedQuantity = D("0.8");
    reduced.inputs[0]!.quantity = D("240");
    repository.findProductionById.mockImplementation(async (_id: string, tx?: object) =>
      tx === undefined ? production() : production("IN_PROGRESS", [reduced]),
    );
    repository.consumeProductionInput.mockResolvedValue(consumed("240", "3950"));

    await finish(true);

    expect(repository.consumeProductionInput.mock.calls[0]![1]).toMatchObject({ quantity: D("240") });
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

    expect(repository.previewProductionLeftovers).toHaveBeenCalledWith(
      [expect.objectContaining({ id: ITEM })],
      expect.any(String),
    );
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

const node = (id: string, parentId: string | null, status: "PENDING" | "PRODUCED" | "DAMAGED" = "PENDING") => ({
  id,
  quantity: D("2"),
  product: { sku: `sku-${id}`, description: id, unit: "KILOGRAM" },
  parent: parentId === null ? null : { id: parentId },
  damage: status === "DAMAGED" ? { id: "damage-1" } : null,
  production: status === "PRODUCED" ? { status: "FINISHED" } : null,
  items: [
    { product: MILK, plannedQuantity: D("10"), weighedQuantity: D("9.5") },
    { product: { ...MILK, sku: "sku-sugar" }, plannedQuantity: D("4"), weighedQuantity: null },
  ],
});

describe("itemFromPreWeighing", () => {
  it("guides by what was weighed, and by what was planned for a line that was not weighed", () => {
    // @ts-expect-error a partial record is enough here
    const item = itemFromPreWeighing(node("root", null));

    expect(item).toEqual({
      productSku: "sku-root",
      preWeighingId: "root",
      expectedQuantity: D("2"),
      inputs: [
        { productSku: "sku-milk", quantity: D("9.5") },
        { productSku: "sku-sugar", quantity: D("4") },
      ],
    });
  });
});

describe("startProduction guided", () => {
  beforeEach(() => {
    preWeighings.findPreWeighingTree.mockReset();
    preWeighings.isPendingStartRoot.mockReset();
    repository.insertProduction.mockReset();
    repository.insertProduction.mockResolvedValue(production());
  });

  it("makes an item of the root and of each pending descendant, cutting a branch at a produced one", async () => {
    preWeighings.isPendingStartRoot.mockResolvedValue(true);
    preWeighings.findPreWeighingTree.mockResolvedValue([
      node("root", null),
      node("filling", "root"),
      node("filling-child", "filling", "PRODUCED"),
      node("under-produced", "filling-child"),
      node("shell", "root"),
      node("damaged", "root", "DAMAGED"),
    ]);

    const result = await startProduction({ createdById: "user-1", preWeighingId: "root" });

    expect(result.ok).toBe(true);
    expect(
      repository.insertProduction.mock.calls[0]![0].items.map((item: { preWeighingId: string }) => item.preWeighingId),
    ).toEqual(["root", "filling", "shell"]);
  });

  it("answers 404 for a pre-weighing that does not exist", async () => {
    preWeighings.findPreWeighingTree.mockResolvedValue([]);

    expect(await startProduction({ createdById: "user-1", preWeighingId: "x" })).toMatchObject({
      ok: false,
      status: 404,
      message: "Pre-weighing not found.",
    });
  });

  it("answers 409 for a pre-weighing that is not a pending root", async () => {
    preWeighings.findPreWeighingTree.mockResolvedValue([node("child", "root")]);
    preWeighings.isPendingStartRoot.mockResolvedValue(false);

    expect(await startProduction({ createdById: "user-1", preWeighingId: "child" })).toMatchObject({
      ok: false,
      status: 409,
      message: "The pre-weighing is not a pending root.",
    });
    expect(repository.insertProduction).not.toHaveBeenCalled();
  });
});

describe("reduceProductionItem", () => {
  it("refuses an item already finished, and rescales nothing", async () => {
    repository.findProductionById.mockResolvedValue(
      production("IN_PROGRESS", [{ ...itemOf(ITEM, "Pudim", "input-1"), status: "FINISHED" }]),
    );

    expect(await reduceProductionItem({ productionId: "production-1", itemId: ITEM, quantity: "0.5" })).toEqual({
      ok: false,
      status: 409,
      message: "The item is not pending.",
    });
    expect(repository.rescaleProductionItem).not.toHaveBeenCalled();
  });
});

describe("recordProductionWeighing", () => {
  it("plans the weighing before it holds the production, and holds nothing for a plan refused", async () => {
    const refused = { ok: false, status: 409, message: "The items do not match the ingredients of the recipe." };
    preWeighingService.preparePreWeighing.mockResolvedValue(refused);

    const result = await recordProductionWeighing({
      productionId: "production-1",
      createdById: "user-1",
      itemId: ITEM,
      tree: { productSku: "sku-Pudim", quantity: "1", items: [], stages: [] },
    });

    expect(result).toEqual(refused);
    expect(repository.inProductionTransaction).not.toHaveBeenCalled();
  });
});
