import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { useRouter } from "next/navigation";
import { planProductionItem, weighItem } from "@/features/productions/actions";
import { ItemWeighingPanel } from "@/features/productions/ItemWeighingPanel";
import type { PreWeighingPlan, ProductionItem } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aPreWeighingPlan, aProduction, aProductionBatch, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({
  planProductionItem: vi.fn(),
  weighItem: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const USER = aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] });
const SHELL = { sku: "sku-shell", description: "Casquinha", unit: "KILOGRAM" as const };
const SUGAR = { sku: "sku-sugar", description: "Açúcar", unit: "KILOGRAM" as const };
const FILLING = { sku: "sku-filling", description: "Recheio", unit: "KILOGRAM" as const };

const shell = (over: Partial<ProductionItem> = {}) =>
  aProductionItem({
    id: "item-shell",
    product: SHELL,
    expectedQuantity: "50",
    batches: [aProductionBatch({ quantity: "20" })],
    ...over,
  });

const planFor = (quantity: string): PreWeighingPlan =>
  aPreWeighingPlan({
    product: SHELL,
    quantity,
    items: [
      { product: SUGAR, plannedQuantity: "0.5", lots: [], shortfall: "0", manufactured: null },
      {
        product: FILLING,
        plannedQuantity: "2",
        lots: [],
        shortfall: "0",
        manufactured: { needed: "2", inStock: "5", toProduce: "0", stage: null },
      },
    ],
  });

function open(item: ProductionItem = shell(), onDone = vi.fn()) {
  const production = aProduction({ id: "prod-1", items: [item] });

  renderWithProviders(<ItemWeighingPanel production={production} item={item} onDone={onDone} />, { user: USER });

  return onDone;
}

beforeEach(() => {
  vi.mocked(planProductionItem)
    .mockReset()
    .mockImplementation(async ({ quantity }) => ({
      ok: true,
      data: planFor(quantity),
    }));
  vi.mocked(weighItem).mockReset().mockResolvedValue({ ok: true, data: aProduction() });
  vi.mocked(toast.error).mockReset();
});

describe("ItemWeighingPanel", () => {
  it("starts with what is missing and plans it", async () => {
    open();

    expect(screen.getByLabelText("Quanto fazer")).toHaveValue("30");
    expect(await screen.findByLabelText("Pesado de Açúcar")).toBeInTheDocument();
    expect(planProductionItem).toHaveBeenCalledWith({ productSku: "sku-shell", quantity: "30" });
  });

  it("starts with the expected quantity on an item awaiting a weighing", async () => {
    open(shell({ awaitsWeighing: true, batches: [] }));

    expect(screen.getByLabelText("Quanto fazer")).toHaveValue("50");
    await screen.findByLabelText("Pesado de Açúcar");
  });

  it("plans again for what was typed, and shows a row per ingredient", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByLabelText("Pesado de Açúcar");

    await user.clear(screen.getByLabelText("Quanto fazer"));
    await user.type(screen.getByLabelText("Quanto fazer"), "12");
    await user.click(screen.getByRole("button", { name: "Calcular" }));

    await waitFor(() =>
      expect(planProductionItem).toHaveBeenLastCalledWith({ productSku: "sku-shell", quantity: "12" }),
    );
    expect(await screen.findByText("Açúcar")).toBeInTheDocument();
    expect(screen.getByText("500 g")).toBeInTheDocument();
    expect(screen.getByText("Recheio")).toBeInTheDocument();
    expect(screen.getByText("do estoque")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pesado de Recheio")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pesado de Açúcar")).toHaveClass("bg-background");
  });

  it("records the weighing, converting what was weighed to the product unit", async () => {
    const user = userEvent.setup();
    const onDone = open();

    await user.type(await screen.findByLabelText("Pesado de Açúcar"), "510");
    await user.click(screen.getByRole("button", { name: "Registrar pesagem" }));

    await waitFor(() =>
      expect(weighItem).toHaveBeenCalledWith("prod-1", "item-shell", {
        quantity: "30",
        items: [{ productSku: "sku-sugar", weighedQuantity: "0.51" }, { productSku: "sku-filling" }],
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("asks for what was not weighed", async () => {
    const user = userEvent.setup();
    open();

    await screen.findByLabelText("Pesado de Açúcar");
    await user.click(screen.getByRole("button", { name: "Registrar pesagem" }));

    expect(await screen.findByText("Informe o pesado, com até 3 casas decimais.")).toBeInTheDocument();
    expect(weighItem).not.toHaveBeenCalled();
  });

  it.each(["The items do not match the ingredients of the recipe.", "A stage does not match the plan."])(
    "tells to calculate again when the recipe or the product changed (%s)",
    async (message) => {
      const user = userEvent.setup();
      vi.mocked(weighItem).mockResolvedValue({ ok: false, status: 409, message });
      open();

      await user.type(await screen.findByLabelText("Pesado de Açúcar"), "510");
      await user.click(screen.getByRole("button", { name: "Registrar pesagem" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("A receita ou o produto mudou. Calcule de novo.");
    },
  );

  it("refreshes the page when the item changed meanwhile, saying so", async () => {
    const user = userEvent.setup();
    vi.mocked(weighItem).mockResolvedValue({ ok: false, status: 409, message: "The item is not pending." });
    const refresh = vi.spyOn(useRouter(), "refresh");
    onTestFinished(() => refresh.mockRestore());
    open();

    await user.type(await screen.findByLabelText("Pesado de Açúcar"), "510");
    await user.click(screen.getByRole("button", { name: "Registrar pesagem" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Um item mudou enquanto isso. A página foi atualizada."),
    );
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText("A receita ou o produto mudou. Calcule de novo.")).not.toBeInTheDocument();
  });
});
