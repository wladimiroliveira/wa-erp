import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishProductionItems, previewLeftovers, reduceProductionItem } from "@/features/productions/actions";
import { FinishItemForm } from "@/features/productions/FinishItemForm";
import type { Production, ProductionItem } from "@/lib/api";
import { leftoversSettled } from "@/tests/leftovers";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aProduction, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({
  finishProductionItems: vi.fn(),
  previewLeftovers: vi.fn(),
  reduceProductionItem: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PRODUCTION = aProduction();
const ITEM = PRODUCTION.items[0]!;
const USER = aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] });

function open(production: Production = PRODUCTION, item: ProductionItem = ITEM) {
  return renderWithProviders(<FinishItemForm production={production} item={item} />, { user: USER });
}

const finish = () => userEvent.click(screen.getByRole("button", { name: "Finalizar Pão francês" }));
const typeProduced = (value: string) => userEvent.type(screen.getByLabelText("Produzido de Pão francês"), value);

const NO_LEFTOVERS = { ok: true as const, data: { items: [], totalCost: "0.00" } };

beforeEach(() => {
  vi.mocked(previewLeftovers).mockReset().mockResolvedValue(NO_LEFTOVERS);
  vi.mocked(finishProductionItems).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe("FinishItemForm", () => {
  it("shows the quantity and expiry fields from the start", async () => {
    open();

    expect(screen.getByLabelText("Produzido de Pão francês")).toBeInTheDocument();
    expect(screen.getByLabelText("Validade de Pão francês")).toBeInTheDocument();

    await leftoversSettled();
  });

  it("finishes only its item with the typed quantity and expiry", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await typeProduced("9,5");
    await userEvent.type(screen.getByLabelText("Validade de Pão francês"), "2099-01-31");
    await finish();

    await waitFor(() =>
      expect(finishProductionItems).toHaveBeenCalledWith(PRODUCTION.id, {
        items: [{ id: ITEM.id, producedQuantity: "9.5", expiresAt: "2099-01-31" }],
        hasLeftoversInCost: true,
      }),
    );
  });

  it("sends no expiry when none is given", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await typeProduced("10");
    await finish();

    await waitFor(() =>
      expect(finishProductionItems).toHaveBeenCalledWith(PRODUCTION.id, {
        items: [{ id: ITEM.id, producedQuantity: "10", expiresAt: null }],
        hasLeftoversInCost: true,
      }),
    );
  });

  it("refuses a blank produced quantity without calling the server", async () => {
    open();

    await waitFor(() => expect(screen.getByRole("button", { name: "Finalizar Pão francês" })).toBeEnabled());
    await finish();

    expect(await screen.findByText("Informe o produzido, com até 6 casas decimais.")).toBeInTheDocument();
    expect(finishProductionItems).not.toHaveBeenCalled();
  });

  it("refuses an expiry in the past without calling the server", async () => {
    open();

    await typeProduced("10");
    await userEvent.type(screen.getByLabelText("Validade de Pão francês"), "2020-01-01");
    await finish();

    expect(await screen.findByText("A validade não pode estar no passado.")).toBeInTheDocument();
    expect(finishProductionItems).not.toHaveBeenCalled();
  });

  // The refresh that follows shows the production closed and takes this form off the page, so the
  // explanation must outlive the form.
  it("explains a production finished or canceled meanwhile in a message that outlives the form", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: false, status: 409, message: "Not in progress." });
    const { unmount } = open();

    await typeProduced("10");
    await finish();
    unmount();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Um item mudou enquanto isso. A página foi atualizada."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts the items finished while the production stays in progress", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction() });
    open();

    await typeProduced("10");
    await finish();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Itens finalizados."));
  });

  it("toasts the production finished once it became finished", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await typeProduced("10");
    await finish();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Produção finalizada."));
  });

  it("explains an item that waits for others with the message the server gave", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({
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

    await typeProduced("10");
    await finish();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Pão francês aguarda Recheio. A página foi atualizada."),
    );
  });
});

describe("FinishItemForm, intermediates short in stock", () => {
  const DOUGH = { sku: "018f0000-0000-7000-8000-0000000000d1", description: "Massa base", unit: "KILOGRAM" as const };

  it("opens the shortage dialog with what is missing", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({
      ok: false,
      status: 409,
      message: "Not enough stock.",
      details: {
        message: "Not enough stock.",
        shortages: [{ itemId: ITEM.id, product: DOUGH, needed: "12", available: "4.5" }],
        items: [{ itemId: ITEM.id, maxQuantity: "40" }],
      },
    });
    open();

    await typeProduced("10");
    await finish();

    const dialog = await screen.findByRole("dialog", { name: "Falta material intermediário" });
    expect(dialog).toHaveTextContent("Massa base: precisa 12 kg, tem 4,5 kg");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("closes the shortage dialog once an item is reduced", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({
      ok: false,
      status: 409,
      message: "Not enough stock.",
      details: {
        message: "Not enough stock.",
        shortages: [{ itemId: ITEM.id, product: DOUGH, needed: "12", available: "4.5" }],
        items: [{ itemId: ITEM.id, maxQuantity: "4" }],
      },
    });
    vi.mocked(reduceProductionItem).mockResolvedValue({
      ok: true,
      data: aProduction({ items: [{ ...ITEM, expectedQuantity: "4" }] }),
    });
    open();

    await typeProduced("10");
    await finish();
    await screen.findByRole("dialog", { name: "Falta material intermediário" });
    await userEvent.click(screen.getByRole("button", { name: "Reduzir" }));

    await waitFor(() => expect(reduceProductionItem).toHaveBeenCalledWith(PRODUCTION.id, ITEM.id, "4"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("FinishItemForm, one stage of several", () => {
  const SHELL_ID = "018f0000-0000-7000-8000-0000000000c2";
  const product = (description: string) => ({ ...ITEM.product, description });
  const STAGED = aProduction({
    items: [
      aProductionItem({ product: product("Bombom"), dependsOn: [SHELL_ID] }),
      aProductionItem({ id: SHELL_ID, product: product("Casquinha") }),
    ],
  });

  it("asks the preview for its own id only and finishes just its own item", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: STAGED });
    open(STAGED, STAGED.items[1]!);

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledWith(STAGED.id, [SHELL_ID]));
    await userEvent.type(screen.getByLabelText("Produzido de Casquinha"), "50");
    await userEvent.click(screen.getByRole("button", { name: "Finalizar Casquinha" }));

    await waitFor(() =>
      expect(finishProductionItems).toHaveBeenCalledWith(STAGED.id, {
        items: [{ id: SHELL_ID, producedQuantity: "50", expiresAt: null }],
        hasLeftoversInCost: true,
      }),
    );
  });
});

describe("FinishItemForm, leftovers of opened packagings", () => {
  const MILK = { sku: "018f0000-0000-7000-8000-000000000024", description: "Leite condensado", unit: "GRAM" as const };
  const WITH_LEFTOVERS = {
    ok: true as const,
    data: {
      items: [
        {
          itemId: ITEM.id,
          leftovers: [
            {
              product: MILK,
              lotId: "018f0000-0000-7000-8000-000000000060",
              quantity: "95",
              unitCost: "0.02",
              cost: "1.90",
            },
          ],
        },
      ],
      totalCost: "1.90",
    },
  };

  const section = () => screen.getByRole("region", { name: "Sobras que serão descartadas" });

  it("asks for the leftovers of its item when it mounts", async () => {
    open();

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledWith(PRODUCTION.id, [ITEM.id]));
  });

  it("tells what will be discarded and puts it into the cost unless unchecked", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue(WITH_LEFTOVERS);
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    expect(await screen.findByText("Leite condensado: 95 g (R$ 1,90)")).toBeInTheDocument();
    expect(section()).toHaveTextContent("Total: R$ 1,90");
    const inCost = screen.getByRole("checkbox", { name: "Incluir as sobras no custo da produção" });
    expect(inCost).toBeChecked();

    await userEvent.click(inCost);
    await typeProduced("10");
    await finish();

    await waitFor(() =>
      expect(finishProductionItems).toHaveBeenCalledWith(
        PRODUCTION.id,
        expect.objectContaining({ hasLeftoversInCost: false }),
      ),
    );
  });

  it("shows nothing about leftovers when there are none", async () => {
    open();

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledWith(PRODUCTION.id, [ITEM.id]));
    expect(screen.queryByRole("region", { name: "Sobras que serão descartadas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Incluir as sobras no custo da produção" })).not.toBeInTheDocument();
  });

  it("still finishes when the leftovers could not be worked out", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue({ ok: false, status: 403, message: "Permission denied." });
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    expect(await screen.findByText("Não foi possível calcular as sobras.")).toBeInTheDocument();
    // Whatever the server finds is still the user's to keep out of the cost.
    await userEvent.click(screen.getByRole("checkbox", { name: "Incluir as sobras no custo da produção" }));
    await typeProduced("10");
    await finish();

    await waitFor(() =>
      expect(finishProductionItems).toHaveBeenCalledWith(
        PRODUCTION.id,
        expect.objectContaining({ hasLeftoversInCost: false }),
      ),
    );
  });
});

describe("FinishItemForm, while the leftovers are worked out", () => {
  const MILK = { sku: "018f0000-0000-7000-8000-000000000024", description: "Leite condensado", unit: "GRAM" as const };
  const lotOf = (lotId: string) => ({ product: MILK, lotId, quantity: "0.25", unitCost: "0.02", cost: "0.01" });

  it("does not finish until the leftovers are known, and says it is working them out", () => {
    vi.mocked(previewLeftovers).mockReturnValue(new Promise(() => undefined));
    open();

    expect(screen.getByRole("status")).toHaveTextContent("Calculando as sobras…");
    expect(screen.getByRole("button", { name: "Finalizar Pão francês" })).toBeDisabled();
  });

  it("announces the leftovers once they arrive", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            itemId: ITEM.id,
            leftovers: [{ ...lotOf("018f0000-0000-7000-8000-000000000060"), quantity: "95", cost: "1.90" }],
          },
        ],
        totalCost: "1.90",
      },
    });
    open();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Leite condensado: 95 g (R$ 1,90)"));
    expect(screen.getByRole("button", { name: "Finalizar Pão francês" })).toBeEnabled();
  });

  it("prices a line of several lots the way the total is priced, rounding once", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            itemId: ITEM.id,
            leftovers: [lotOf("018f0000-0000-7000-8000-000000000060"), lotOf("018f0000-0000-7000-8000-000000000061")],
          },
        ],
        totalCost: "0.01",
      },
    });
    open();

    expect(await screen.findByText("Leite condensado: 0,5 g (R$ 0,01)")).toBeInTheDocument();
    expect(screen.getByText("Total: R$ 0,01")).toBeInTheDocument();
  });

  it("works the leftovers out again when the page brings the production anew", async () => {
    const { rerender } = open();

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledTimes(1));
    rerender(<FinishItemForm production={{ ...PRODUCTION }} item={ITEM} />);

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledTimes(2));
  });
});
