import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reduceProductionItem } from "@/features/productions/actions";
import { ShortageDialog } from "@/features/productions/ShortageDialog";
import type { FinishConflict, Production } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aProduction, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({ reduceProductionItem: vi.fn() }));

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
  const onReduced = vi.fn();
  renderWithProviders(
    <ShortageDialog production={production} conflict={conflict} onClose={onClose} onReduced={onReduced} />,
  );
  const dialog = screen.getByRole("dialog", { name: "Falta material intermediário" });
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

  return { dialog, onClose, onReduced };
}

beforeEach(() => {
  vi.mocked(reduceProductionItem).mockReset();
});

describe("ShortageDialog", () => {
  it("links a new weighing for the missing quantity", async () => {
    await open(aProduction({ id: "p1", items: [BREAD] }));

    expect(screen.getByRole("link", { name: "Nova pesagem" })).toHaveAttribute(
      "href",
      `/pre-weighings/new?productionId=p1&parentId=w1&productSku=${DOUGH.sku}&quantity=7.5`,
    );
  });

  it("reduces from the maximum the stock allows", async () => {
    const reduced = aProduction({ id: "p1", items: [{ ...BREAD, expectedQuantity: "40" }] });
    vi.mocked(reduceProductionItem).mockResolvedValue({ ok: true, data: reduced });
    const { onReduced } = await open(aProduction({ id: "p1", items: [BREAD] }));

    expect(screen.getByLabelText("Nova quantidade")).toHaveValue("40");
    await userEvent.click(screen.getByRole("button", { name: "Reduzir" }));

    await waitFor(() => expect(reduceProductionItem).toHaveBeenCalledWith("p1", "i1", "40"));
    await waitFor(() => expect(onReduced).toHaveBeenCalledWith(reduced));
  });

  it("sends the quantity typed in place of the maximum", async () => {
    vi.mocked(reduceProductionItem).mockResolvedValue({ ok: true, data: aProduction({ id: "p1" }) });
    await open(aProduction({ id: "p1", items: [BREAD] }));

    await userEvent.clear(screen.getByLabelText("Nova quantidade"));
    await userEvent.type(screen.getByLabelText("Nova quantidade"), "32,5");
    await userEvent.click(screen.getByRole("button", { name: "Reduzir" }));

    await waitFor(() => expect(reduceProductionItem).toHaveBeenCalledWith("p1", "i1", "32.5"));
  });

  it("explains a reduction the server refused", async () => {
    vi.mocked(reduceProductionItem).mockResolvedValue({ ok: false, status: 409, message: "Out of range." });
    const { onReduced } = await open(aProduction({ id: "p1", items: [BREAD] }));

    await userEvent.click(screen.getByRole("button", { name: "Reduzir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A nova quantidade precisa ser menor que a prevista e caber nas casas decimais da unidade, ou a produção já foi finalizada ou cancelada.",
    );
    expect(onReduced).not.toHaveBeenCalled();
  });

  it("hides Nova pesagem on an item without a pre-weighing", async () => {
    await open(aProduction({ id: "p1", items: [{ ...BREAD, preWeighingId: null }] }));

    expect(screen.getByText("Massa base: precisa 12 kg, tem 4,5 kg")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nova pesagem" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reduzir" })).toBeInTheDocument();
  });

  // Two items made from the same intermediate are short together: one line says how much of it is missing.
  it("shows an intermediate shared by several items as one line with what they need together", async () => {
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
    // The first short item has no pre-weighing; the next one guides the new weighing.
    expect(within(dialog).getByRole("link", { name: "Nova pesagem" })).toHaveAttribute(
      "href",
      `/pre-weighings/new?productionId=p1&parentId=w2&productSku=${DOUGH.sku}&quantity=1.5`,
    );
    expect(within(dialog).getAllByRole("button", { name: "Reduzir" })).toHaveLength(2);
    expect(
      within(within(dialog).getByRole("group", { name: "Pão de leite" })).getByLabelText("Nova quantidade"),
    ).toHaveValue("12");
  });

  // The balance can go below zero: what the stock owes is still shown in the unit that reads best.
  it("shows a balance below zero with its sign", async () => {
    await open(aProduction({ id: "p1", items: [BREAD] }), {
      ...SHORT_OF_DOUGH,
      shortages: [{ itemId: "i1", product: DOUGH, needed: "12", available: "-4.5" }],
    });

    expect(screen.getByText("Massa base: precisa 12 kg, tem -4,5 kg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nova pesagem" })).toHaveAttribute(
      "href",
      `/pre-weighings/new?productionId=p1&parentId=w1&productSku=${DOUGH.sku}&quantity=16.5`,
    );
  });

  // A new weighing is of a quantity the operator could pick: it rounds up so that it covers what is missing.
  it.each([
    ["to three places", DOUGH, "1", "0.333333", "0.667"],
    ["to a whole unit", { ...DOUGH, unit: "UNIT" as const }, "10", "2.5", "8"],
  ])("rounds the missing quantity up %s", async (_label, product, needed, available, quantity) => {
    await open(aProduction({ id: "p1", items: [BREAD] }), {
      ...SHORT_OF_DOUGH,
      shortages: [{ itemId: "i1", product, needed, available }],
    });

    expect(screen.getByRole("link", { name: "Nova pesagem" })).toHaveAttribute(
      "href",
      `/pre-weighings/new?productionId=p1&parentId=w1&productSku=${DOUGH.sku}&quantity=${quantity}`,
    );
  });

  it.each([
    ["a fraction of a unit", ROLL, "i2", "7,5", "Informe uma quantidade inteira."],
    ["a fourth decimal place", BREAD, "i1", "32,1234", "Informe a nova quantidade, com até 3 casas decimais."],
  ])("refuses to reduce to %s", async (_label, item, itemId, typed, message) => {
    await open(aProduction({ id: "p1", items: [item] }), { ...SHORT_OF_DOUGH, items: [{ itemId, maxQuantity: "8" }] });

    await userEvent.clear(screen.getByLabelText("Nova quantidade"));
    await userEvent.type(screen.getByLabelText("Nova quantidade"), typed);
    await userEvent.click(screen.getByRole("button", { name: "Reduzir" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(reduceProductionItem).not.toHaveBeenCalled();
  });

  it("closes when asked", async () => {
    const { onClose } = await open(aProduction({ id: "p1", items: [BREAD] }));

    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(onClose).toHaveBeenCalled();
  });
});
