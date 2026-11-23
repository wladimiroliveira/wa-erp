import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishProductionItems, previewLeftovers, reduceProductionItem } from "@/features/productions/actions";
import { FinishProductionForm } from "@/features/productions/FinishProductionForm";
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

function open() {
  return renderWithProviders(<FinishProductionForm production={PRODUCTION} />, {
    user: aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] }),
  });
}

const finish = () => userEvent.click(screen.getByRole("button", { name: "Finalizar selecionados" }));
const pick = (name: string) => userEvent.click(screen.getByRole("checkbox", { name }));

const NO_LEFTOVERS = { ok: true as const, data: { items: [], totalCost: "0.00" } };

beforeEach(() => {
  vi.mocked(previewLeftovers).mockReset().mockResolvedValue(NO_LEFTOVERS);
  vi.mocked(finishProductionItems).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe("FinishProductionForm", () => {
  it("finishes with what each item produced and its expiry", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await pick("Pão francês");
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "9,5");
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

    await pick("Pão francês");
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
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

    await pick("Pão francês");
    await finish();

    expect(await screen.findByText("Informe o produzido, com até 6 casas decimais.")).toBeInTheDocument();
    expect(finishProductionItems).not.toHaveBeenCalled();
  });

  it("refuses an expiry in the past without calling the server", async () => {
    open();

    await pick("Pão francês");
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
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

    await pick("Pão francês");
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await finish();
    unmount();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Um item mudou enquanto isso. A página foi atualizada."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("FinishProductionForm, what the form offers", () => {
  it("lists the items unchecked, with the quantity and expiry only for the checked ones", async () => {
    open();

    expect(screen.getByRole("checkbox", { name: "Pão francês" })).not.toBeChecked();
    expect(screen.queryByLabelText("Produzido de Pão francês")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finalizar selecionados" })).toBeDisabled();
    expect(previewLeftovers).not.toHaveBeenCalled();

    await pick("Pão francês");

    expect(screen.getByLabelText("Produzido de Pão francês")).toBeInTheDocument();
    expect(screen.getByLabelText("Validade de Pão francês")).toBeInTheDocument();
  });

  it("toasts the items finished while the production stays in progress", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction() });
    open();

    await pick("Pão francês");
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await finish();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Itens finalizados."));
  });

  it("toasts the production finished once it became finished", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await pick("Pão francês");
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
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

    await pick("Pão francês");
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await finish();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Pão francês aguarda Recheio. A página foi atualizada."),
    );
  });
});

describe("FinishProductionForm, intermediates short in stock", () => {
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

    await pick("Pão francês");
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
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

    await pick("Pão francês");
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await finish();
    await screen.findByRole("dialog", { name: "Falta material intermediário" });
    await userEvent.click(screen.getByRole("button", { name: "Reduzir" }));

    await waitFor(() => expect(reduceProductionItem).toHaveBeenCalledWith(PRODUCTION.id, ITEM.id, "4"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("FinishProductionForm, a production finished item by item", () => {
  const SHELL_ID = "018f0000-0000-7000-8000-0000000000c2";
  const FILLING_ID = "018f0000-0000-7000-8000-0000000000c3";
  const product = (description: string) => ({ ...ITEM.product, description });
  const STAGED = aProduction({
    items: [
      aProductionItem({ product: product("Bombom"), dependsOn: [FILLING_ID, SHELL_ID] }),
      aProductionItem({ id: FILLING_ID, product: product("Recheio"), status: "FINISHED" }),
      aProductionItem({ id: SHELL_ID, product: product("Casquinha") }),
    ],
  });
  const FILLING_PENDING = aProductionItem({ id: FILLING_ID, product: product("Recheio") });
  const WITH_TWO = aProduction({ items: [STAGED.items[0]!, FILLING_PENDING, STAGED.items[2]!] });

  it("finishes just the recheio when only it is checked", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: WITH_TWO });
    renderWithProviders(<FinishProductionForm production={WITH_TWO} />, {
      user: aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] }),
    });

    await pick("Recheio");
    await userEvent.type(screen.getByLabelText("Produzido de Recheio"), "20");
    await finish();

    await waitFor(() =>
      expect(finishProductionItems).toHaveBeenCalledWith(WITH_TWO.id, {
        items: [{ id: FILLING_ID, producedQuantity: "20", expiresAt: null }],
        hasLeftoversInCost: true,
      }),
    );
    expect(previewLeftovers).toHaveBeenCalledWith(WITH_TWO.id, [FILLING_ID]);
  });

  it("never asks for the leftovers of an item awaiting a weighing", async () => {
    const damaged = aProduction({
      items: [
        aProductionItem({ id: "ok", product: product("Recheio") }),
        aProductionItem({ id: "bad", product: product("Casquinha"), awaitsWeighing: true }),
      ],
    });
    renderWithProviders(<FinishProductionForm production={damaged} />, {
      user: aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] }),
    });

    expect(screen.queryByRole("checkbox", { name: "Casquinha" })).not.toBeInTheDocument();
    await pick("Recheio");
    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledWith(damaged.id, ["ok"]));
  });

  it("finishes only the checked items", async () => {
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: STAGED });
    renderWithProviders(<FinishProductionForm production={STAGED} />, {
      user: aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] }),
    });

    expect(screen.queryByRole("checkbox", { name: "Bombom" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Recheio" })).not.toBeInTheDocument();
    await pick("Casquinha");
    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledWith(STAGED.id, [SHELL_ID]));

    await userEvent.type(screen.getByLabelText("Produzido de Casquinha"), "50");
    await finish();

    await waitFor(() =>
      expect(finishProductionItems).toHaveBeenCalledWith(STAGED.id, {
        items: [{ id: SHELL_ID, producedQuantity: "50", expiresAt: null }],
        hasLeftoversInCost: true,
      }),
    );
  });
});

describe("FinishProductionForm, the next items after a refresh", () => {
  it("starts blank for the items a refresh brings", async () => {
    const shellId = "018f0000-0000-7000-8000-0000000000c2";
    const product = (description: string) => ({ ...ITEM.product, description });
    const before = aProduction({
      items: [
        aProductionItem({ product: product("Bombom"), dependsOn: [shellId] }),
        aProductionItem({ id: shellId, product: product("Casquinha") }),
      ],
    });
    const after = aProduction({
      items: [before.items[0]!, { ...before.items[1]!, status: "FINISHED" }],
    });
    const user = aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] });
    const { rerender } = renderWithProviders(<FinishProductionForm production={before} />, { user });
    await pick("Casquinha");
    await userEvent.type(screen.getByLabelText("Produzido de Casquinha"), "50");

    rerender(<FinishProductionForm production={after} />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Bombom" }));

    expect(screen.getByLabelText("Produzido de Bombom")).toHaveValue("");
  });
});

describe("FinishProductionForm, leftovers of opened packagings", () => {
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

  it("tells what will be discarded and puts it into the cost unless unchecked", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue(WITH_LEFTOVERS);
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await pick("Pão francês");
    expect(await screen.findByText("Leite condensado: 95 g (R$ 1,90)")).toBeInTheDocument();
    expect(section()).toHaveTextContent("Total: R$ 1,90");
    const inCost = screen.getByRole("checkbox", { name: "Incluir as sobras no custo da produção" });
    expect(inCost).toBeChecked();

    await userEvent.click(inCost);
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
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

    await pick("Pão francês");
    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledWith(PRODUCTION.id, [ITEM.id]));
    expect(screen.queryByRole("region", { name: "Sobras que serão descartadas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Incluir as sobras no custo da produção" })).not.toBeInTheDocument();
  });

  it("still finishes when the leftovers could not be worked out", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue({ ok: false, status: 403, message: "Permission denied." });
    vi.mocked(finishProductionItems).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await pick("Pão francês");
    expect(await screen.findByText("Não foi possível calcular as sobras.")).toBeInTheDocument();
    // Whatever the server finds is still the user's to keep out of the cost.
    await userEvent.click(screen.getByRole("checkbox", { name: "Incluir as sobras no custo da produção" }));
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await finish();

    await waitFor(() =>
      expect(finishProductionItems).toHaveBeenCalledWith(
        PRODUCTION.id,
        expect.objectContaining({ hasLeftoversInCost: false }),
      ),
    );
  });
});

describe("FinishProductionForm, while the leftovers are worked out", () => {
  const MILK = { sku: "018f0000-0000-7000-8000-000000000024", description: "Leite condensado", unit: "GRAM" as const };
  const lotOf = (lotId: string) => ({ product: MILK, lotId, quantity: "0.25", unitCost: "0.02", cost: "0.01" });

  it("does not finish until the leftovers are known, and says it is working them out", async () => {
    vi.mocked(previewLeftovers).mockReturnValue(new Promise(() => undefined));
    open();

    await pick("Pão francês");
    expect(screen.getByRole("status")).toHaveTextContent("Calculando as sobras…");
    expect(screen.getByRole("button", { name: "Finalizar selecionados" })).toBeDisabled();
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

    await pick("Pão francês");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Leite condensado: 95 g (R$ 1,90)"));
    expect(screen.getByRole("button", { name: "Finalizar selecionados" })).toBeEnabled();
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

    await pick("Pão francês");
    expect(await screen.findByText("Leite condensado: 0,5 g (R$ 0,01)")).toBeInTheDocument();
    expect(screen.getByText("Total: R$ 0,01")).toBeInTheDocument();
  });

  it("works the leftovers out again when the page brings the production anew", async () => {
    const { rerender } = open();

    await pick("Pão francês");
    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledTimes(1));
    rerender(<FinishProductionForm production={{ ...PRODUCTION }} />);

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledTimes(2));
  });
});
