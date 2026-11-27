import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadOutflows, quoteOutflow, registerOutflow } from "@/features/stock-outflows/actions";
import { StockOutflowsPage } from "@/features/stock-outflows/StockOutflowsPage";
import type { OutflowPage, Permission } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, anOutflow, anOutflowSummary, aProduct } from "@/tests/samples";

vi.mock("@/features/stock-outflows/actions", () => ({
  loadOutflows: vi.fn(),
  quoteOutflow: vi.fn(),
  registerOutflow: vi.fn(),
}));

const loadMock = vi.mocked(loadOutflows);

const BREAD = aProduct({ sku: "018f0000-0000-7000-8000-000000000021", description: "Pão francês", unit: "UNIT" });

const onePage = (items: OutflowPage["items"], nextCursor: string | null = null): OutflowPage => ({ items, nextCursor });

function renderPage(page: OutflowPage, permissions: Permission[] = ["SALES_READ", "SALES_CREATE", "CATALOG_READ"]) {
  return renderWithProviders(
    <StockOutflowsPage
      page={page}
      summary={anOutflowSummary()}
      products={[BREAD]}
      from="2026-11-01"
      to="2026-11-30"
      productSku={undefined}
    />,
    { route: "/stock-outflows?from=2026-11-01&to=2026-11-30", user: aCurrentUser({ permissions }) },
  );
}

beforeEach(() => {
  loadMock.mockReset();
  vi.mocked(quoteOutflow).mockReset();
  vi.mocked(registerOutflow).mockReset();
});

describe("StockOutflowsPage", () => {
  it("shows the summary cards", () => {
    renderPage(onePage([]));

    expect(screen.getByText("Vendido").nextSibling).toHaveTextContent("R$ 120,00");
    expect(screen.getByText("Lucro das vendas").nextSibling).toHaveTextContent("R$ 40,00");
    expect(screen.getByText("Doado (a custo)").nextSibling).toHaveTextContent("R$ 15,00");
    expect(screen.getByText("Resultado").nextSibling).toHaveTextContent("R$ 25,00");
  });

  it("lists a sale and a donation with their values", async () => {
    renderPage(
      onePage([
        anOutflow({ id: "sale" }),
        anOutflow({
          id: "gift",
          kind: "DONATION",
          unitPrice: null,
          listPrice: null,
          revenue: null,
          profit: null,
          cost: "18.40",
          quantity: "2",
        }),
      ]),
    );

    const [, sale, gift] = await screen.findAllByRole("row");

    expect(within(sale!).getByText("10/11/2026", { exact: false })).toBeInTheDocument();
    expect(within(sale!).getByText("Venda")).toBeInTheDocument();
    expect(within(sale!).getByText("Pão francês")).toBeInTheDocument();
    expect(within(sale!).getByText("3 un")).toBeInTheDocument();
    expect(within(sale!).getAllByText("R$ 13,80")).toHaveLength(2);
    expect(within(sale!).getByText("R$ 41,40")).toBeInTheDocument();
    expect(within(sale!).getByText("R$ 27,60")).toBeInTheDocument();

    expect(within(gift!).getByText("Doação")).toBeInTheDocument();
    expect(within(gift!).getByText("R$ 18,40")).toBeInTheDocument();
    expect(within(gift!).getByText("R$ -18,40")).toBeInTheDocument();
  });

  it("writes the period into the address when it changes", async () => {
    renderPage(onePage([]));

    const from = screen.getByLabelText("De");
    await userEvent.clear(from);
    await userEvent.type(from, "2026-10-01");

    await waitFor(() => expect(navigation.url).toContain("from=2026-10-01"));
    expect(navigation.url).toContain("to=2026-11-30");
  });

  it("loads the next page with the cursor", async () => {
    loadMock.mockResolvedValue({ ok: true, data: onePage([anOutflow({ id: "older" })]) });
    renderPage(onePage([anOutflow({ id: "newer" })], "cursor-1"));

    await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));

    await waitFor(() =>
      expect(loadMock).toHaveBeenCalledWith({
        from: "2026-11-01",
        to: "2026-11-30",
        productSku: undefined,
        cursor: "cursor-1",
        limit: 50,
      }),
    );
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("offers a new outflow only to whoever may create one", () => {
    renderPage(onePage([]), ["SALES_READ"]);

    expect(screen.queryByRole("button", { name: "Nova saída" })).not.toBeInTheDocument();
  });

  it("opens the dialog from Nova saída", async () => {
    renderPage(onePage([]));

    await userEvent.click(screen.getByRole("button", { name: "Nova saída" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
