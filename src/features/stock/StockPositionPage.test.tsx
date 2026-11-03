import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { StockPositionPage } from "@/features/stock/StockPositionPage";
import type { StockPosition } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aStockItem, aStockPosition } from "@/tests/samples";
import { columnHeaders } from "@/tests/table-layouts";

const product = (description: string) => ({
  sku: `sku-${description}`,
  description,
  unit: "KILOGRAM" as const,
});

const rowOf = (description: string) => within(screen.getByText(description).closest("tr")!);

const renderPage = (
  position: StockPosition = aStockPosition(),
  tableLayouts = [] as { tableKey: string; order: string[]; widths: Record<string, number> }[],
) => renderWithProviders(<StockPositionPage position={position} />, { tableLayouts });

describe("StockPositionPage", () => {
  it("shows the balance, the minimum, the costs and the value of each product", async () => {
    renderPage(
      aStockPosition({
        items: [
          aStockItem({
            product: product("Farinha de trigo"),
            quantity: "1250.5",
            minimumQuantity: "500",
            lastEntryCost: "4.5",
            averageCost: "4.25",
            value: "5314.63",
          }),
        ],
        totalValue: "5314.63",
      }),
    );

    await screen.findByText("Farinha de trigo");
    const flour = rowOf("Farinha de trigo");

    expect(flour.getByText("1.250,5 kg")).toBeInTheDocument();
    expect(flour.getByText("500 kg")).toBeInTheDocument();
    expect(flour.getByText("R$ 4,50")).toBeInTheDocument();
    expect(flour.getByText("R$ 4,25")).toBeInTheDocument();
    expect(flour.getByText("R$ 5.314,63")).toBeInTheDocument();
    expect(flour.getByText("OK")).toBeInTheDocument();
  });

  it("names each situation in Portuguese", async () => {
    renderPage(
      aStockPosition({
        items: [
          aStockItem({ product: product("Açúcar"), status: "BELOW_MINIMUM" }),
          aStockItem({ product: product("Fermento"), status: "NEGATIVE", quantity: "-3" }),
          aStockItem({ product: product("Sal"), status: "EMPTY", quantity: "0" }),
          aStockItem({ product: product("Leite"), status: "EXPIRED" }),
          aStockItem({ product: product("Manteiga"), status: "EXPIRING_SOON" }),
        ],
      }),
    );

    await screen.findByText("Açúcar");
    expect(rowOf("Leite").getByText("Vencido")).toBeInTheDocument();
    expect(rowOf("Manteiga").getByText("Vence em breve")).toBeInTheDocument();
    expect(rowOf("Açúcar").getByText("Abaixo do mínimo")).toBeInTheDocument();
    expect(rowOf("Fermento").getByText("Negativo")).toBeInTheDocument();
    expect(rowOf("Fermento").getByText("-3 kg")).toBeInTheDocument();
    expect(rowOf("Sal").getByText("Zerado")).toBeInTheDocument();
  });

  it("leaves a dash where a product has no minimum and never had a cost", async () => {
    renderPage(
      aStockPosition({
        items: [
          aStockItem({
            product: product("Sal"),
            quantity: "0",
            minimumQuantity: null,
            lastEntryCost: null,
            averageCost: null,
            value: "0.00",
            status: "EMPTY",
          }),
        ],
      }),
    );

    await screen.findByText("Sal");
    expect(rowOf("Sal").getAllByText("—")).toHaveLength(4);
    expect(rowOf("Sal").getByText("R$ 0,00")).toBeInTheDocument();
  });

  it("shows what the whole stock is worth and how many products need attention", async () => {
    renderPage(
      aStockPosition({
        items: [
          aStockItem({ product: product("Farinha de trigo") }),
          aStockItem({ product: product("Açúcar"), status: "BELOW_MINIMUM" }),
          aStockItem({ product: product("Fermento"), status: "NEGATIVE" }),
          aStockItem({ product: product("Sal"), status: "EMPTY" }),
        ],
        totalValue: "12345.60",
      }),
    );

    const summary = within(await screen.findByRole("group", { name: "Resumo do estoque" }));
    expect(summary.getByText("R$ 12.345,60")).toBeInTheDocument();
    expect(within(summary.getByText("Produtos").parentElement!).getByText("4")).toBeInTheDocument();
    expect(within(summary.getByText("Pedem atenção").parentElement!).getByText("3")).toBeInTheDocument();
  });

  it("shows only what needs attention when asked, and everything again when asked back", async () => {
    renderPage(
      aStockPosition({
        items: [
          aStockItem({ product: product("Farinha de trigo") }),
          aStockItem({ product: product("Açúcar"), status: "BELOW_MINIMUM" }),
        ],
      }),
    );

    await userEvent.click(await screen.findByRole("checkbox", { name: "Só o que pede atenção" }));

    expect(screen.getByText("Açúcar")).toBeInTheDocument();
    expect(screen.queryByText("Farinha de trigo")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Só o que pede atenção" }));

    expect(screen.getByText("Farinha de trigo")).toBeInTheDocument();
  });

  it("says nothing needs attention instead of showing a bare table", async () => {
    renderPage(aStockPosition({ items: [aStockItem()] }));

    await userEvent.click(await screen.findByRole("checkbox", { name: "Só o que pede atenção" }));

    expect(screen.getByText("Nenhum produto pede atenção.")).toBeInTheDocument();
  });

  it("says the catalog is empty instead of showing a bare table", async () => {
    renderPage(aStockPosition({ items: [], totalValue: "0.00" }));

    expect(await screen.findByText("Nenhum produto cadastrado ainda.")).toBeInTheDocument();
  });

  it("tells how many lots a product holds and when the next one expires", async () => {
    renderPage(
      aStockPosition({
        items: [aStockItem({ product: product("Leite"), lotCount: 3, nextExpiresAt: "2026-12-31" })],
      }),
    );

    await screen.findByText("Leite");
    expect(rowOf("Leite").getByText("3")).toBeInTheDocument();
    expect(rowOf("Leite").getByText("31/12/2026")).toBeInTheDocument();
  });

  it("leads from a product to its lots", async () => {
    renderPage(aStockPosition({ items: [aStockItem({ product: product("Leite") })] }));

    expect(await screen.findByRole("link", { name: "Leite" })).toHaveAttribute("href", "/stock/sku-Leite");
  });
});

describe("StockPositionPage layout", () => {
  it("gives the table the height left on the screen", async () => {
    renderPage();

    await screen.findByRole("table");
    expect(screen.getByRole("table").parentElement).toHaveAttribute("data-fill", "true");
  });
});

describe("StockPositionPage columns", () => {
  it("shows the columns in the order the user arranged them", async () => {
    renderPage(aStockPosition({ items: [aStockItem()] }), [
      { tableKey: "stock-position", order: ["quantity", "product"], widths: {} },
    ]);

    await waitFor(() => expect(columnHeaders()[0]).toBe("Saldo"));
  });
});

describe("StockPositionPage sizing", () => {
  it("keeps the filter and the links to each product as tall as a control", async () => {
    renderPage(aStockPosition({ items: [aStockItem({ product: product("Leite") })] }));
    const label = await screen.findByText("Só o que pede atenção");

    expect(label).toHaveClass("py-1.5");
    expect(label.parentElement).toHaveClass("min-h-8");
    expect(screen.getByRole("link", { name: "Leite" })).toHaveClass("min-h-8");
  });
});
