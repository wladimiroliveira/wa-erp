import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStockMovements } from "@/features/stock-movements/actions";
import { StockMovementsPage } from "@/features/stock-movements/StockMovementsPage";
import type { Permission, StockMovementPage as MovementPage } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aProduct, aStockMovement } from "@/tests/samples";
import { columnHeaders } from "@/tests/table-layouts";

vi.mock("@/features/stock-movements/actions", () => ({ loadStockMovements: vi.fn() }));

const loadMock = vi.mocked(loadStockMovements);

const FLOUR = aProduct({ sku: "018f0000-0000-7000-8000-000000000020", description: "Farinha de trigo" });

interface RenderOptions {
  permissions?: Permission[];
  productSku?: string;
  tableLayouts?: { tableKey: string; order: string[]; widths: Record<string, number> }[];
}

const onePage = (items: MovementPage["items"], nextCursor: string | null = null): MovementPage => ({
  items,
  nextCursor,
});

function renderPage(page: MovementPage, options: RenderOptions = {}) {
  const { permissions = ["ENTRIES_READ", "CATALOG_READ"], productSku, tableLayouts = [] } = options;

  return renderWithProviders(
    <StockMovementsPage
      page={page}
      products={permissions.includes("CATALOG_READ") ? [FLOUR] : []}
      productSku={productSku}
    />,
    {
      route: productSku === undefined ? "/stock-movements" : `/stock-movements?productSku=${productSku}`,
      user: aCurrentUser({ permissions }),
      tableLayouts,
    },
  );
}

beforeEach(() => {
  loadMock.mockReset();
});

describe("StockMovementsPage", () => {
  it("lists each movement with its date, product, kind, signed quantity, cost and author", async () => {
    renderPage(
      onePage([
        aStockMovement({
          id: "movement-2",
          type: "PRODUCTION_CONSUMPTION",
          quantity: "2.5",
          unitCost: "4.25",
          createdAt: "2026-10-02T12:00:00.000Z",
          createdBy: { id: "user-1", name: "Ana" },
        }),
        aStockMovement({ id: "movement-1", type: "ENTRY", quantity: "10", createdAt: "2026-10-01T12:00:00.000Z" }),
      ]),
    );

    const [, consumption, entry] = await screen.findAllByRole("row");

    expect(within(consumption!).getByText(/^02\/10\/2026/)).toBeInTheDocument();
    expect(within(consumption!).getByText("Farinha de trigo")).toBeInTheDocument();
    expect(within(consumption!).getByText("Saída")).toBeInTheDocument();
    expect(within(consumption!).getByText("Consumo na produção")).toBeInTheDocument();
    expect(within(consumption!).getByText("−2,5 kg")).toBeInTheDocument();
    expect(within(consumption!).getByText("R$ 4,25")).toBeInTheDocument();
    expect(within(consumption!).getByText("Ana")).toBeInTheDocument();

    expect(within(entry!).getByText("Entrada")).toBeInTheDocument();
    expect(within(entry!).getByText("Lançamento de entrada")).toBeInTheDocument();
    expect(within(entry!).getByText("+10 kg")).toBeInTheDocument();
  });

  it("says nothing has moved instead of showing a bare table", async () => {
    renderPage(onePage([]));

    expect(await screen.findByText("Nenhuma movimentação encontrada.")).toBeInTheDocument();
  });

  it("asks the address for the movements of the product chosen in the filter", async () => {
    renderPage(onePage([]));

    await userEvent.selectOptions(await screen.findByLabelText("Produto"), "Farinha de trigo");

    // The server reads the first page for the address; the screen only changes the address.
    await waitFor(() => expect(navigation.url).toBe(`/stock-movements?productSku=${FLOUR.sku}`));
  });

  it("shows the product the address filters by as chosen, and lets it go", async () => {
    renderPage(onePage([]), { productSku: FLOUR.sku });

    expect(await screen.findByLabelText("Produto")).toHaveValue(FLOUR.sku);

    await userEvent.selectOptions(screen.getByLabelText("Produto"), "Todos os produtos");

    await waitFor(() => expect(navigation.url).toBe("/stock-movements"));
  });

  it("leaves the product filter out for whoever may not read the catalog", async () => {
    renderPage(onePage([aStockMovement()]), { permissions: ["ENTRIES_READ"] });

    await screen.findByText("Lançamento de entrada");
    expect(screen.queryByLabelText("Produto", { selector: "select" })).not.toBeInTheDocument();
  });

  it("loads the older movements on request, until there are no more", async () => {
    loadMock.mockResolvedValue({
      ok: true,
      data: onePage([aStockMovement({ id: "movement-1", type: "PRODUCTION_OUTPUT" })]),
    });

    renderPage(onePage([aStockMovement({ id: "movement-2" })], "movement-2"));

    await userEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));

    expect(await screen.findByText("Produção")).toBeInTheDocument();
    expect(screen.getByText("Lançamento de entrada")).toBeInTheDocument();
    expect(loadMock).toHaveBeenCalledWith({ productSku: undefined, cursor: "movement-2" });
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("keeps the filter when loading the older movements", async () => {
    loadMock.mockResolvedValue({ ok: true, data: onePage([]) });

    renderPage(onePage([aStockMovement({ id: "movement-2" })], "movement-2"), { productSku: FLOUR.sku });

    await userEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));

    await waitFor(() => expect(loadMock).toHaveBeenCalledWith({ productSku: FLOUR.sku, cursor: "movement-2" }));
  });
});

describe("movement lots", () => {
  it("tells the expiry of the lot each movement moved, and a dash where it moved none", async () => {
    renderPage(
      onePage([
        aStockMovement({ id: "movement-3", lot: { id: "lot-1", expiresAt: "2099-12-31", supplier: null } }),
        aStockMovement({ id: "movement-2", lot: { id: "lot-2", expiresAt: null, supplier: null } }),
        aStockMovement({ id: "movement-1", lot: null }),
      ]),
      { permissions: ["ENTRIES_READ"] },
    );

    const [, dated, undated, none] = await screen.findAllByRole("row");

    expect(screen.getByRole("columnheader", { name: "Validade do lote" })).toBeInTheDocument();
    expect(within(dated!).getByText("31/12/2099")).toBeInTheDocument();
    expect(within(undated!).getByText("Sem validade")).toBeInTheDocument();
    expect(within(none!).getByText("—")).toBeInTheDocument();
  });
});

describe("movement kinds", () => {
  it("names the adjustment of a negative balance as something that came in", async () => {
    renderPage(onePage([aStockMovement({ type: "BALANCE_ADJUSTMENT", quantity: "3.5" })]), {
      permissions: ["ENTRIES_READ"],
    });

    expect(await screen.findByText("Ajuste de saldo")).toBeInTheDocument();
    expect(screen.getByText("Entrada")).toBeInTheDocument();
    expect(screen.getByText("+3,5 kg")).toBeInTheDocument();
  });

  it("names a loss as something that left the stock", async () => {
    renderPage(onePage([aStockMovement({ type: "LOSS", quantity: "2.5" })]), { permissions: ["ENTRIES_READ"] });

    expect(await screen.findByText("Avaria")).toBeInTheDocument();
    expect(screen.getByText("Saída")).toBeInTheDocument();
    expect(screen.getByText("−2,5 kg")).toBeInTheDocument();
  });

  it("tells whether each movement came into the stock or left it, apart from where it came from", async () => {
    renderPage(
      onePage([
        aStockMovement({ id: "movement-2", type: "PRODUCTION_OUTPUT" }),
        aStockMovement({ id: "movement-1", type: "PRODUCTION_CONSUMPTION" }),
      ]),
      { permissions: ["ENTRIES_READ"] },
    );

    const [header, output, consumption] = await screen.findAllByRole("row");

    expect(within(header!).getByRole("columnheader", { name: "Tipo" })).toBeInTheDocument();
    expect(within(header!).getByRole("columnheader", { name: "Origem" })).toBeInTheDocument();
    expect(within(output!).getByText("Entrada")).toBeInTheDocument();
    expect(within(output!).getByText("Produção")).toBeInTheDocument();
    expect(within(consumption!).getByText("Saída")).toBeInTheDocument();
  });
});

describe("StockMovementsPage layout", () => {
  it("gives the table the height left on the screen", async () => {
    renderPage(onePage([aStockMovement()]));

    await screen.findByRole("table");
    expect(screen.getByRole("table").parentElement).toHaveAttribute("data-fill", "true");
  });
});

describe("StockMovementsPage columns", () => {
  it("shows the columns in the order the user arranged them", async () => {
    renderPage(onePage([aStockMovement()]), {
      tableLayouts: [{ tableKey: "stock-movements", order: ["product", "date"], widths: {} }],
    });

    await waitFor(() => expect(columnHeaders()[0]).toBe("Produto"));
  });
});
