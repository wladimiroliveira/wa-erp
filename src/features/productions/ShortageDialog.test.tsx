import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addShortageItem } from "@/features/productions/actions";
import { ShortageDialog } from "@/features/productions/ShortageDialog";
import type { FinishConflict, Production } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aProduction, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({ addShortageItem: vi.fn() }));

const DOUGH = { sku: "018f0000-0000-7000-8000-0000000000d1", description: "Massa base", unit: "KILOGRAM" as const };

const BREAD = aProductionItem({ id: "i1", preWeighingId: "w1" });
const ROLL = aProductionItem({
  id: "i2",
  preWeighingId: "w2",
  product: { sku: "018f0000-0000-7000-8000-000000000091", description: "Pão de leite", unit: "UNIT" },
});

const SHORT_OF_DOUGH: FinishConflict = {
  message: "Not enough stock.",
  shortages: [{ itemId: "i1", product: DOUGH, needed: "12", available: "4.5" }],
  items: [{ itemId: "i1", maxQuantity: "40" }],
};

// The dialog takes the focus a moment after it opens: typing before that would lose keys to it.
async function open(production: Production, conflict: FinishConflict = SHORT_OF_DOUGH) {
  const onClose = vi.fn();
  renderWithProviders(<ShortageDialog production={production} conflict={conflict} onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "Falta material intermediário" });
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

  return { dialog, onClose };
}

beforeEach(() => {
  vi.mocked(addShortageItem).mockReset();
});

const addButton = () => screen.getByRole("button", { name: "Nova pesagem" });

describe("ShortageDialog", () => {
  it("adds an item of the short product for the missing quantity, then closes", async () => {
    vi.mocked(addShortageItem).mockResolvedValue({ ok: true, data: aProduction({ id: "p1" }) });
    const { onClose } = await open(aProduction({ id: "p1", items: [BREAD] }));

    await userEvent.click(addButton());

    await waitFor(() => expect(addShortageItem).toHaveBeenCalledWith("p1", { productSku: DOUGH.sku, quantity: "7.5" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("offers Nova pesagem even on an item without a pre-weighing, and never Reduzir", async () => {
    await open(aProduction({ id: "p1", items: [{ ...BREAD, preWeighingId: null }] }));

    expect(screen.getByText("Massa base: precisa 12 kg, tem 4,5 kg")).toBeInTheDocument();
    expect(addButton()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reduzir" })).not.toBeInTheDocument();
  });

  it("keeps the dialog open and says why when the server refuses", async () => {
    vi.mocked(addShortageItem).mockResolvedValue({ ok: false, status: 409, message: "x" });
    const { onClose } = await open(aProduction({ id: "p1", items: [BREAD] }));

    await userEvent.click(addButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("A produção mudou enquanto isso. Atualize a página.");
    expect(onClose).not.toHaveBeenCalled();
  });

  // Two items made from the same intermediate are short together: one line says how much of it is missing.
  it("shows an intermediate shared by several items as one line with what they need together", async () => {
    vi.mocked(addShortageItem).mockResolvedValue({ ok: true, data: aProduction({ id: "p1" }) });
    const { dialog } = await open(aProduction({ id: "p1", items: [{ ...BREAD, preWeighingId: null }, ROLL] }), {
      message: "Not enough stock.",
      shortages: [
        { itemId: "i1", product: DOUGH, needed: "3", available: "4" },
        { itemId: "i2", product: DOUGH, needed: "2.5", available: "4" },
      ],
      items: [
        { itemId: "i1", maxQuantity: "8" },
        { itemId: "i2", maxQuantity: "12" },
      ],
    });

    expect(within(dialog).getByText("Massa base: precisa 5,5 kg, tem 4 kg")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Nova pesagem" }));

    await waitFor(() => expect(addShortageItem).toHaveBeenCalledWith("p1", { productSku: DOUGH.sku, quantity: "1.5" }));
  });

  // The balance can go below zero: what the stock owes is still shown in the unit that reads best.
  it("shows a balance below zero with its sign", async () => {
    vi.mocked(addShortageItem).mockResolvedValue({ ok: true, data: aProduction({ id: "p1" }) });
    await open(aProduction({ id: "p1", items: [BREAD] }), {
      ...SHORT_OF_DOUGH,
      shortages: [{ itemId: "i1", product: DOUGH, needed: "12", available: "-4.5" }],
    });

    expect(screen.getByText("Massa base: precisa 12 kg, tem -4,5 kg")).toBeInTheDocument();
    await userEvent.click(addButton());

    await waitFor(() =>
      expect(addShortageItem).toHaveBeenCalledWith("p1", { productSku: DOUGH.sku, quantity: "16.5" }),
    );
  });

  // A new weighing is of a quantity the operator could pick: it rounds up so that it covers what is missing.
  it.each([
    ["to three places", DOUGH, "1", "0.333333", "0.667"],
    ["to a whole unit", { ...DOUGH, unit: "UNIT" as const }, "10", "2.5", "8"],
  ])("rounds the missing quantity up %s", async (_label, product, needed, available, quantity) => {
    vi.mocked(addShortageItem).mockResolvedValue({ ok: true, data: aProduction({ id: "p1" }) });
    await open(aProduction({ id: "p1", items: [BREAD] }), {
      ...SHORT_OF_DOUGH,
      shortages: [{ itemId: "i1", product, needed, available }],
    });

    await userEvent.click(addButton());

    await waitFor(() => expect(addShortageItem).toHaveBeenCalledWith("p1", { productSku: DOUGH.sku, quantity }));
  });

  it("closes when asked", async () => {
    const { onClose } = await open(aProduction({ id: "p1", items: [BREAD] }));

    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(onClose).toHaveBeenCalled();
  });
});
