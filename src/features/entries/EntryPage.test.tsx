import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEntry, type CreateEntryResult } from "@/features/entries/actions";
import { EntryPage } from "@/features/entries/EntryPage";
import type { CreateEntryBody, Product, Supplier } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { renderWithProviders } from "@/tests/render";
import { aProduct, aSupplier, anEntry } from "@/tests/samples";

vi.mock("@/features/entries/actions", () => ({ createEntry: vi.fn() }));

const createEntryMock = vi.mocked(createEntry);

const FLOUR = aProduct({ sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo" });
const MILL = aSupplier({ id: "018f0000-0000-7000-8000-000000000050", name: "Moinho Santa Clara" });

function renderPage(products: Product[] = [FLOUR], suppliers: Supplier[] = [MILL]) {
  return renderWithProviders(<EntryPage products={products} suppliers={suppliers} />);
}

/** Captures what the screen sends and answers every attempt with `respond`. */
function recordingEntries(respond: (body: CreateEntryBody) => CreateEntryResult): CreateEntryBody[] {
  const received: CreateEntryBody[] = [];

  createEntryMock.mockImplementation(async (body) => {
    received.push(body);
    return respond(body);
  });

  return received;
}

const created = (): CreateEntryResult => ({ ok: true, data: anEntry() });

async function fillEntry({ quantity = "10", unitCost = "4", expiresAt = "" as string | null } = {}) {
  await userEvent.selectOptions(await screen.findByLabelText("Produto"), "Farinha de trigo (kg)");
  await userEvent.type(screen.getByLabelText("Quantidade"), quantity);
  await userEvent.type(screen.getByLabelText("Custo unitário"), unitCost);

  if (expiresAt === null) await userEvent.click(screen.getByRole("checkbox", { name: "Sem data de validade" }));
  else if (expiresAt !== "") await userEvent.type(screen.getByLabelText("Validade"), expiresAt);
}

const submit = () => userEvent.click(screen.getByRole("button", { name: "Lançar entrada" }));

beforeEach(() => {
  createEntryMock.mockReset();
});

describe("EntryPage", () => {
  it("offers only the active products, each with its unit", async () => {
    renderPage([
      FLOUR,
      aProduct({ sku: "018f0000-0000-7000-8000-000000000021", description: "Fermento", isActive: false }),
    ]);

    expect(await screen.findByRole("option", { name: "Farinha de trigo (kg)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Fermento/ })).not.toBeInTheDocument();
  });

  it("says there is nothing to receive when no product is active", async () => {
    renderPage([]);

    expect(await screen.findByText("Nenhum produto ativo cadastrado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lançar entrada" })).not.toBeInTheDocument();
  });

  it("refuses an entry with no product, a zero quantity, no cost and nothing said about the expiry", async () => {
    renderPage();

    await screen.findByLabelText("Produto");
    await userEvent.type(screen.getByLabelText("Quantidade"), "0");
    await submit();

    expect(await screen.findByText("Escolha o produto.")).toBeInTheDocument();
    expect(screen.getByText("A quantidade deve ser maior que zero.")).toBeInTheDocument();
    expect(screen.getByText("Informe o custo unitário, com até 6 casas decimais.")).toBeInTheDocument();
    expect(screen.getByText('Informe a validade ou marque "Sem data de validade".')).toBeInTheDocument();
    expect(createEntryMock).not.toHaveBeenCalled();
  });

  it("shows the cost as money and the quantity in the product's unit, and sends plain decimals", async () => {
    const received = recordingEntries(created);

    renderPage();
    await fillEntry({ quantity: "1250,5", unitCost: "1234,5", expiresAt: null });

    const quantity = screen.getByLabelText("Quantidade");
    const unitCost = screen.getByLabelText("Custo unitário");
    expect(quantity).toHaveValue("1.250,5");
    expect(within(quantity.parentElement!).getByText("kg")).toBeInTheDocument();
    expect(unitCost).toHaveValue("1.234,50");
    expect(within(unitCost.parentElement!).getByText("R$")).toBeInTheDocument();

    await submit();

    await waitFor(() => expect(received[0]).toMatchObject({ quantity: "1250.5", unitCost: "1234.50" }));
  });

  it("refuses a lot that has already expired", async () => {
    renderPage();
    await fillEntry({ expiresAt: "2020-01-01" });
    await submit();

    expect(await screen.findByText("A validade não pode ser anterior a hoje.")).toBeInTheDocument();
  });

  it("accepts a lot that expires today", async () => {
    const received = recordingEntries(created);

    renderPage();
    await fillEntry({ expiresAt: todayIso() });
    await submit();

    await waitFor(() => expect(received[0]).toMatchObject({ expiresAt: todayIso() }));
  });

  it("sends the entry with decimal points, the expiry and the supplier", async () => {
    const received = recordingEntries(created);

    renderPage();
    await fillEntry({ quantity: "10,5", unitCost: "4,25", expiresAt: "2099-12-31" });
    await userEvent.selectOptions(screen.getByLabelText("Fornecedor (opcional)"), "Moinho Santa Clara");
    await submit();

    await waitFor(() =>
      expect(received).toEqual([
        { productSku: FLOUR.sku, quantity: "10.5", unitCost: "4.25", expiresAt: "2099-12-31", supplierId: MILL.id },
      ]),
    );
  });

  it("sends a lot that never expires and has no supplier as such", async () => {
    const received = recordingEntries(created);

    renderPage();
    await fillEntry({ expiresAt: null });
    await submit();

    await waitFor(() =>
      expect(received).toEqual([{ productSku: FLOUR.sku, quantity: "10", unitCost: "4.00", expiresAt: null }]),
    );
  });

  it("stops asking for the date once the lot is said not to expire", async () => {
    renderPage();
    await fillEntry({ expiresAt: "2099-12-31" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Sem data de validade" }));

    expect(screen.getByLabelText("Validade")).toBeDisabled();
    expect(screen.getByLabelText("Validade")).toHaveValue("");
  });

  it("shows the lot that was opened and where the stock landed", async () => {
    recordingEntries(() => ({
      ok: true,
      data: anEntry({
        quantity: "10.5",
        product: { sku: FLOUR.sku, description: "Farinha de trigo", unit: "KILOGRAM" },
        lot: { id: "lot-1", expiresAt: "2099-12-31", supplier: MILL, quantity: "10.5" },
        stock: { quantity: "40.5", lastEntryCost: "4.25", averageCost: "5.5" },
      }),
    }));

    renderPage();
    await fillEntry({ expiresAt: "2099-12-31" });
    await submit();

    const result = within(await screen.findByRole("status"));
    expect(result.getByText("Entrada lançada: 10,5 kg de Farinha de trigo.")).toBeInTheDocument();
    expect(result.getByText("31/12/2099")).toBeInTheDocument();
    expect(result.getByText("Moinho Santa Clara")).toBeInTheDocument();
    expect(result.getByText("40,5 kg")).toBeInTheDocument();
    expect(result.getByText("R$ 4,25")).toBeInTheDocument();
    expect(result.getByText("R$ 5,50")).toBeInTheDocument();
  });

  it("says the lot has no expiry and no supplier when it has none", async () => {
    recordingEntries(created);

    renderPage();
    await fillEntry({ expiresAt: null });
    await submit();

    const result = within(await screen.findByRole("status"));
    expect(result.getByText("Sem validade")).toBeInTheDocument();
    expect(result.getByText("—")).toBeInTheDocument();
  });

  it("clears the form after an entry, ready for the next one", async () => {
    recordingEntries(created);

    renderPage();
    await fillEntry({ expiresAt: null });
    await submit();

    await screen.findByRole("status");
    expect(screen.getByLabelText("Produto")).toHaveValue("");
    expect(screen.getByLabelText("Quantidade")).toHaveValue("");
    expect(screen.getByLabelText("Custo unitário")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Sem data de validade" })).not.toBeChecked();
  });

  it("says the product is inactive, in Portuguese, and keeps what was typed", async () => {
    recordingEntries(() => ({ ok: false, status: 409, message: "Product is inactive." }));

    renderPage();
    await fillEntry({ expiresAt: null });
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Esse produto está inativo e não recebe entradas.");
    expect(screen.getByLabelText("Quantidade")).toHaveValue("10");
  });

  it("explains an action that threw differently from a refusal", async () => {
    createEntryMock.mockRejectedValue(new Error("fetch failed"));

    renderPage();
    await fillEntry({ expiresAt: null });
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível concluir a operação. Tente de novo.");
  });

  describe("on a product whose balance is negative", () => {
    const owing = () =>
      recordingEntries((body) =>
        body.deficit === undefined
          ? { ok: false, status: 409, message: "The product has a negative balance to settle.", deficit: "3.5" }
          : created(),
      );

    it("shows what is owed and asks how to settle it before recording anything", async () => {
      owing();

      renderPage();
      await fillEntry({ expiresAt: null });
      await submit();

      const dialog = within(await screen.findByRole("alertdialog"));
      expect(dialog.getByText(/Farinha de trigo está com o estoque negativo em 3,5 kg/)).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("records the entry over a zeroed balance when asked to", async () => {
      const received = owing();

      renderPage();
      await fillEntry({ expiresAt: null });
      await submit();
      await userEvent.click(await screen.findByRole("button", { name: "Zerar o saldo antes" }));

      await screen.findByRole("status");
      expect(received[1]).toEqual({
        productSku: FLOUR.sku,
        quantity: "10",
        unitCost: "4.00",
        expiresAt: null,
        deficit: "ZERO",
      });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("records the entry paying what is owed when asked to", async () => {
      const received = owing();

      renderPage();
      await fillEntry({ expiresAt: null });
      await submit();
      await userEvent.click(await screen.findByRole("button", { name: "Descontar da entrada" }));

      await screen.findByRole("status");
      expect(received[1]).toMatchObject({ deficit: "DISCOUNT" });
    });

    it("records nothing and keeps what was typed when the operator backs out", async () => {
      const received = owing();

      renderPage();
      await fillEntry({ expiresAt: null });
      await submit();
      await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(received).toHaveLength(1);
      expect(screen.getByLabelText("Quantidade")).toHaveValue("10");
    });
  });
});

describe("EntryPage sizing", () => {
  it("keeps the no-expiry row as tall as a control", async () => {
    renderPage();
    const label = await screen.findByText("Sem data de validade");

    expect(label).toHaveClass("py-1.5");
    expect(label.parentElement).toHaveClass("min-h-8");
  });
});
