import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StockProductPage } from "@/features/stock/StockProductPage";
import type { Permission, ProductStock } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aProductStock, aStockLot } from "@/tests/samples";
import { columnHeaders } from "@/tests/table-layouts";
import { chooseRowAction } from "@/tests/row-actions";

vi.mock("@/features/losses/actions", () => ({ createLoss: vi.fn() }));

interface RenderOptions {
  depleted?: boolean;
  permissions?: Permission[];
  tableLayouts?: { tableKey: string; order: string[]; widths: Record<string, number> }[];
}

function renderPage(stock: ProductStock = aProductStock(), options: RenderOptions = {}) {
  const { depleted = false, permissions = ["REPORTS_READ"], tableLayouts = [] } = options;

  return renderWithProviders(<StockProductPage stock={stock} reasons={[]} depleted={depleted} />, {
    route: depleted ? "/stock/sku-1?depleted=true" : "/stock/sku-1",
    params: { sku: "sku-1" },
    user: aCurrentUser({ permissions }),
    tableLayouts,
  });
}

const rows = async () => (await screen.findAllByRole("row")).slice(1).map((row) => within(row));

describe("StockProductPage", () => {
  it("names the product and sums up its position", async () => {
    renderPage(
      aProductStock({ quantity: "1250.5", value: "5314.63", nextExpiresAt: "2026-12-31", status: "EXPIRING_SOON" }),
    );

    expect(await screen.findByRole("heading", { name: "Farinha de trigo" })).toBeInTheDocument();

    const summary = within(screen.getByRole("group", { name: "Resumo do produto" }));
    expect(summary.getByText("1.250,5 kg")).toBeInTheDocument();
    expect(summary.getByText("R$ 5.314,63")).toBeInTheDocument();
    expect(summary.getByText("31/12/2026")).toBeInTheDocument();
    expect(summary.getByText("Vence em breve")).toBeInTheDocument();
  });

  it("lists each lot with its expiry, supplier, entry date, quantities, cost, value and situation", async () => {
    renderPage(
      aProductStock({
        lots: [
          aStockLot({
            id: "lot-1",
            expiresAt: "2026-10-20",
            supplier: { id: "supplier-1", name: "Moinho Santa Clara" },
            initialQuantity: "8",
            quantity: "3",
            unitCost: "6",
            value: "18.00",
            createdAt: "2026-10-02T12:00:00.000Z",
            status: "EXPIRING_SOON",
          }),
          aStockLot({ id: "lot-2", status: "EXPIRED", expiresAt: "2026-10-01" }),
          aStockLot({ id: "lot-3" }),
        ],
      }),
    );

    const [soon, expired, never] = await rows();

    expect(soon!.getByText("20/10/2026")).toBeInTheDocument();
    expect(soon!.getByText("Moinho Santa Clara")).toBeInTheDocument();
    expect(soon!.getByText(/^02\/10\/2026/)).toBeInTheDocument();
    expect(soon!.getByText("8 kg")).toBeInTheDocument();
    expect(soon!.getByText("3 kg")).toBeInTheDocument();
    expect(soon!.getByText("R$ 6,00")).toBeInTheDocument();
    expect(soon!.getByText("R$ 18,00")).toBeInTheDocument();
    expect(soon!.getByText("Vence em breve")).toBeInTheDocument();

    expect(expired!.getByText("Vencido")).toBeInTheDocument();

    expect(never!.getByText("Sem validade")).toBeInTheDocument();
    expect(never!.getByText("—")).toBeInTheDocument();
    expect(never!.getByText("OK")).toBeInTheDocument();
  });

  it("says the product holds no lots instead of showing a bare table", async () => {
    renderPage(aProductStock({ lots: [], quantity: "0", lotCount: 0, status: "EMPTY" }));

    expect(await screen.findByText("Nenhum lote com saldo.")).toBeInTheDocument();
  });

  it("asks the address for the depleted lots when asked, and names them as such", async () => {
    const { rerender } = renderPage(aProductStock({ lots: [] }));

    await userEvent.click(await screen.findByRole("checkbox", { name: "Mostrar lotes esgotados" }));

    // The server reads the list for the address; the screen only changes the address.
    await waitFor(() => expect(navigation.url).toBe("/stock/sku-1?depleted=true"));

    rerender(
      <StockProductPage
        stock={aProductStock({ lots: [aStockLot({ id: "lot-9", quantity: "0", status: "DEPLETED" })] })}
        reasons={[]}
        depleted
      />,
    );

    expect(await screen.findByText("Esgotado")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Mostrar lotes esgotados" })).toBeChecked();
  });

  it("says no lot was ever registered when the depleted ones are in and there are none", async () => {
    renderPage(aProductStock({ lots: [] }), { depleted: true });

    expect(await screen.findByText("Nenhum lote registrado.")).toBeInTheDocument();
  });

  it("leads back to the analysis of the whole stock", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: "Voltar para a análise de estoque" })).toHaveAttribute(
      "href",
      "/stock",
    );
  });

  describe("writing a lot off", () => {
    const heldAndDepleted = () =>
      aProductStock({
        lots: [
          aStockLot({ id: "lot-1", quantity: "3" }),
          aStockLot({ id: "lot-2", quantity: "0", status: "DEPLETED" }),
        ],
      });

    it("offers it on each lot that still holds something, to whoever may record a loss", async () => {
      renderPage(heldAndDepleted(), { permissions: ["REPORTS_READ", "LOSSES_CREATE"] });

      const [held, depleted] = await rows();

      await chooseRowAction("Ações do lote", "Registrar avaria", held!);

      expect(await screen.findByRole("dialog")).toHaveTextContent("saldo de 3 kg");
      expect(depleted!.queryByRole("button", { name: "Ações do lote" })).not.toBeInTheDocument();
    });

    it("hides it from whoever may only read the reports", async () => {
      renderPage(heldAndDepleted(), { permissions: ["REPORTS_READ"] });

      const [held] = await rows();

      expect(held!.getByText("3 kg")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Ações do lote" })).not.toBeInTheDocument();
    });
  });
});

describe("StockProductPage columns", () => {
  it("shows the columns in the order the user arranged them", async () => {
    renderPage(aProductStock(), {
      tableLayouts: [{ tableKey: "stock-lots", order: ["supplier", "expiry"], widths: {} }],
    });

    await waitFor(() => expect(columnHeaders()[0]).toBe("Fornecedor"));
  });
});

describe("StockProductPage sizing", () => {
  it("keeps the way back and the depleted-lots filter as tall as a control", async () => {
    renderPage();
    const label = await screen.findByText("Mostrar lotes esgotados");

    expect(label).toHaveClass("py-1.5");
    expect(label.parentElement).toHaveClass("min-h-8");
    expect(screen.getByRole("link", { name: "Voltar para a análise de estoque" })).toHaveClass("min-h-8");
  });
});
