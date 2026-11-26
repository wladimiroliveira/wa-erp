import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { concludeItem, previewLeftovers } from "@/features/productions/actions";
import { ConcludeItemForm } from "@/features/productions/ConcludeItemForm";
import type { Production, ProductionItem } from "@/lib/api";
import { leftoversSettled } from "@/tests/leftovers";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aProduction, aProductionBatch, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({
  concludeItem: vi.fn(),
  previewLeftovers: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const USER = aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] });
const AT_TARGET = [aProductionBatch({ quantity: "10" })];
const ITEM = aProductionItem({ batches: AT_TARGET });
const PRODUCTION = aProduction({ items: [ITEM] });

function open(production: Production = PRODUCTION, item: ProductionItem = production.items[0]!) {
  return renderWithProviders(<ConcludeItemForm production={production} item={item} />, { user: USER });
}

const concludeButton = (name = "Pão francês") => screen.getByRole("button", { name: `Concluir ${name}` });

async function conclude(name = "Pão francês") {
  await waitFor(() => expect(concludeButton(name)).toBeEnabled());
  await userEvent.click(concludeButton(name));
}

const NO_LEFTOVERS = { ok: true as const, data: { items: [], totalCost: "0.00" } };

beforeEach(() => {
  vi.mocked(previewLeftovers).mockReset().mockResolvedValue(NO_LEFTOVERS);
  vi.mocked(concludeItem).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe("ConcludeItemForm, at the target", () => {
  it("cannot conclude an item without a leva", async () => {
    const production = aProduction({ items: [aProductionItem({ batches: [] })] });
    open(production);

    await leftoversSettled();
    expect(concludeButton()).toBeDisabled();
  });

  it("concludes its item with the leftovers in the cost", async () => {
    vi.mocked(concludeItem).mockResolvedValue({ ok: true, data: aProduction() });
    open();

    await conclude();

    await waitFor(() =>
      expect(concludeItem).toHaveBeenCalledWith(PRODUCTION.id, ITEM.id, { hasLeftoversInCost: true }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("toasts the item concluded while the production stays in progress", async () => {
    vi.mocked(concludeItem).mockResolvedValue({ ok: true, data: aProduction() });
    open();

    await conclude();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Item concluído."));
  });

  it("toasts the production finished once it became finished", async () => {
    vi.mocked(concludeItem).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await conclude();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Produção finalizada."));
  });

  // The refresh that follows may take this form off the page, so the explanation must outlive it.
  it("explains a change made meanwhile in a message that outlives the form", async () => {
    vi.mocked(concludeItem).mockResolvedValue({ ok: false, status: 409, message: "Not in progress." });
    const { unmount } = open();

    await conclude();
    unmount();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Um item mudou enquanto isso. A página foi atualizada."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("explains an item that waits for others with the message the server gave", async () => {
    vi.mocked(concludeItem).mockResolvedValue({
      ok: false,
      status: 409,
      message: "Waiting.",
      details: {
        message: "Waiting.",
        waitingFor: [
          {
            itemId: ITEM.id,
            product: ITEM.product,
            waitsFor: [{ itemId: "x", product: { ...ITEM.product, description: "Recheio" } }],
          },
        ],
      },
    });
    open();

    await conclude();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Pão francês aguarda Recheio. A página foi atualizada."),
    );
  });

  it("opens the shortage dialog with what is missing", async () => {
    const dough = { sku: "018f0000-0000-7000-8000-0000000000d1", description: "Massa base", unit: "KILOGRAM" as const };
    vi.mocked(concludeItem).mockResolvedValue({
      ok: false,
      status: 409,
      message: "Not enough stock.",
      details: {
        message: "Not enough stock.",
        shortages: [{ itemId: ITEM.id, product: dough, needed: "12", available: "4.5" }],
        items: [{ itemId: ITEM.id, maxQuantity: "40" }],
      },
    });
    open();

    await conclude();

    const dialog = await screen.findByRole("dialog", { name: "Falta material intermediário" });
    expect(dialog).toHaveTextContent("Massa base: precisa 12 kg, tem 4,5 kg");
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("ConcludeItemForm, below the target", () => {
  const unit = (description: string) => ({ sku: `sku-${description}`, description, unit: "UNIT" as const });
  const SHELL = aProductionItem({
    id: "018f0000-0000-7000-8000-0000000000c2",
    product: unit("Casquinha"),
    expectedQuantity: "50",
    batches: [aProductionBatch({ quantity: "35" })],
  });
  const MAIN = aProductionItem({
    product: unit("Bombom"),
    expectedQuantity: "100",
    dependsOn: [SHELL.id],
    batches: [aProductionBatch({ quantity: "80" })],
  });
  const STAGED = aProduction({ items: [MAIN, SHELL] });

  it("asks before concluding the main product short of its target, and sends that it is below", async () => {
    vi.mocked(concludeItem).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open(STAGED, MAIN);

    await conclude("Bombom");

    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Rendeu 80 un de 100 un. Concluir assim?")).toBeInTheDocument();
    expect(concludeItem).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Concluir assim" }));

    await waitFor(() =>
      expect(concludeItem).toHaveBeenCalledWith(STAGED.id, MAIN.id, { hasLeftoversInCost: true, belowTarget: true }),
    );
  });

  it("concludes nothing when the operator goes back", async () => {
    open(STAGED, MAIN);

    await conclude("Bombom");
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Voltar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(concludeItem).not.toHaveBeenCalled();
  });

  // Concluding the main product or an intermediate below its target, once confirmed.
  async function confirmBelow(name: string) {
    await conclude(name);
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Concluir assim" }),
    );
  }

  it("asks before concluding an intermediate short of its target too, and sends that it is below", async () => {
    vi.mocked(concludeItem).mockResolvedValue({ ok: true, data: STAGED });
    open(STAGED, SHELL);

    await conclude("Casquinha");

    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Rendeu 35 un de 50 un. Concluir assim?")).toBeInTheDocument();
    expect(concludeItem).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Concluir assim" }));

    await waitFor(() =>
      expect(concludeItem).toHaveBeenCalledWith(STAGED.id, SHELL.id, { hasLeftoversInCost: true, belowTarget: true }),
    );
  });

  it("says what an intermediate short of its target would leave missing for what comes next", async () => {
    vi.mocked(concludeItem).mockResolvedValue({
      ok: false,
      status: 409,
      message: "Below target.",
      details: { message: "Below target.", missing: [{ product: unit("Casquinha"), quantity: "15" }] },
    });
    open(STAGED, SHELL);

    await confirmBelow("Casquinha");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Falta 15 un de Casquinha para o que vem depois. Registre ou pese mais uma leva.",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("ConcludeItemForm, leftovers of opened packagings", () => {
  const MILK = { sku: "018f0000-0000-7000-8000-000000000024", description: "Leite condensado", unit: "GRAM" as const };
  const lotOf = (quantity: string, cost: string) => ({
    product: MILK,
    lotId: "018f0000-0000-7000-8000-000000000060",
    quantity,
    unitCost: "0.02",
    cost,
  });

  it("asks for the leftovers of its own item when it mounts", async () => {
    open();

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledWith(PRODUCTION.id, [ITEM.id]));
    await leftoversSettled();
  });

  it("tells what will be discarded and keeps it out of the cost when unchecked", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue({
      ok: true,
      data: { items: [{ itemId: ITEM.id, leftovers: [lotOf("95", "1.90")] }], totalCost: "1.90" },
    });
    vi.mocked(concludeItem).mockResolvedValue({ ok: true, data: aProduction() });
    open();

    expect(await screen.findByText("Leite condensado: 95 g (R$ 1,90)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Incluir as sobras no custo da produção" }));
    await conclude();

    await waitFor(() =>
      expect(concludeItem).toHaveBeenCalledWith(PRODUCTION.id, ITEM.id, { hasLeftoversInCost: false }),
    );
  });

  it("still offers the choice when the leftovers could not be worked out", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue({ ok: false, status: 403, message: "Permission denied." });
    open();

    expect(await screen.findByText("Não foi possível calcular as sobras.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Incluir as sobras no custo da produção" })).toBeInTheDocument();
  });

  it("does not conclude until the leftovers are known, and says it is working them out", () => {
    vi.mocked(previewLeftovers).mockReturnValue(new Promise(() => undefined));
    open();

    expect(screen.getByRole("status")).toHaveTextContent("Calculando as sobras…");
    expect(concludeButton()).toBeDisabled();
  });

  it("works the leftovers out again when the page brings the production anew", async () => {
    const { rerender } = open();

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledTimes(1));
    rerender(<ConcludeItemForm production={{ ...PRODUCTION }} item={ITEM} />);

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledTimes(2));
    await leftoversSettled();
  });
});
