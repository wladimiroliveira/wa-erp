import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemFromPreWeighing, previewLeftovers, startProduction } from "./productions.service";

const repository = vi.hoisted(() => ({
  findProductionById: vi.fn(),
  inProductionTransaction: vi.fn(),
  insertProduction: vi.fn(),
  listProductions: vi.fn(),
  lockProductionInProgress: vi.fn(),
  previewProductionLeftovers: vi.fn(),
}));

vi.mock("./productions.repository", () => repository);
const preWeighings = vi.hoisted(() => ({ findPreWeighingTree: vi.fn(), isPendingStartRoot: vi.fn() }));

vi.mock("@/server/modules/pre-weighings/pre-weighings.repository", () => preWeighings);
const preWeighingService = vi.hoisted(() => ({ planPreWeighing: vi.fn(), preparePreWeighing: vi.fn() }));

vi.mock("@/server/modules/pre-weighings/pre-weighings.service", () => preWeighingService);

const D = (value: string) => new Prisma.Decimal(value);
const ITEM = "018f0000-0000-7000-8000-0000000000b1";
const MILK = { sku: "sku-milk", description: "Leite condensado", unit: "GRAM", isStorableOnceOpened: false };

const itemOf = (id: string, description: string, inputId: string, storable = false) => ({
  id,
  status: "PENDING" as "PENDING" | "FINISHED" | "SUBSTITUTED",
  finishedAt: null,
  hasLeftoversInCost: null,
  damages: [] as { preWeighingId: string | null }[],
  batches: [],
  extraWeighings: [],
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

beforeEach(() => {
  vi.clearAllMocks();
  repository.findProductionById.mockResolvedValue(production());
  repository.inProductionTransaction.mockImplementation((work: (tx: object) => unknown) => work({}));
  repository.lockProductionInProgress.mockResolvedValue(true);
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
