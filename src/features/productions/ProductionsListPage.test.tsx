import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadMoreProductions } from "@/features/productions/actions";
import { ProductionsListPage } from "@/features/productions/ProductionsListPage";
import type { StatusFilter } from "@/features/productions/status-filter";
import type { Permission, Production, ProductionPage } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aProduction, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({ loadMoreProductions: vi.fn() }));

const page = (items: Production[] = [aProduction()], nextCursor: string | null = null): ProductionPage => ({
  items,
  nextCursor,
});

function open(
  listing: ProductionPage = page(),
  filter: StatusFilter = "IN_PROGRESS",
  permissions: Permission[] = ["PRODUCTION_READ"],
) {
  const route = filter === "IN_PROGRESS" ? "/productions" : `/productions?status=${filter}`;

  return renderWithProviders(<ProductionsListPage page={listing} filter={filter} />, {
    route,
    user: aCurrentUser({ permissions }),
  });
}

beforeEach(() => {
  vi.mocked(loadMoreProductions).mockReset();
});

describe("ProductionsListPage", () => {
  it("lists each production with its start, status, products and item count", () => {
    open(
      page([
        aProduction({
          id: "production-1",
          createdAt: "2026-10-02T12:00:00.000Z",
          items: [
            aProductionItem(),
            aProductionItem({
              id: "item-2",
              product: { sku: "sku-2", description: "Pão de queijo", unit: "KILOGRAM" },
            }),
          ],
        }),
      ]),
    );

    const [, row] = screen.getAllByRole("row");

    expect(within(row!).getByRole("link", { name: /^02\/10\/2026/ })).toHaveAttribute(
      "href",
      "/productions/production-1",
    );
    expect(within(row!).getByText("Em andamento")).toBeInTheDocument();
    expect(within(row!).getByText("Pão francês, Pão de queijo")).toBeInTheDocument();
    expect(within(row!).getByText("2")).toBeInTheDocument();
  });

  it("says no production was found instead of showing a bare table", () => {
    open(page([]));

    expect(screen.getByText("Nenhuma produção encontrada.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("loads the older productions under the same status, until there are no more", async () => {
    vi.mocked(loadMoreProductions).mockResolvedValue({
      ok: true,
      data: page(
        [
          aProduction({
            id: "production-1",
            status: "FINISHED",
            items: [aProductionItem({ product: { sku: "sku-9", description: "Bolo", unit: "UNIT" } })],
          }),
        ],
        null,
      ),
    });
    open(page([aProduction({ id: "production-2", status: "FINISHED" })], "production-2"), "FINISHED");

    await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));

    expect(loadMoreProductions).toHaveBeenCalledWith("FINISHED", "production-2");
    expect(await screen.findByText("Bolo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("loads the older productions of every status when the list shows all", async () => {
    vi.mocked(loadMoreProductions).mockResolvedValue({ ok: true, data: page([], null) });
    open(page([aProduction({ id: "production-2" })], "production-2"), "all");

    await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));

    await waitFor(() => expect(loadMoreProductions).toHaveBeenCalledWith(undefined, "production-2"));
  });

  it("filters by status through the address", async () => {
    open();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Canceladas");

    expect(navigation.url).toBe("/productions?status=CANCELED");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Em andamento");

    expect(navigation.url).toBe("/productions");
  });

  it("offers a new production only to whoever may start one with the catalog", () => {
    const { unmount } = open(page(), "IN_PROGRESS", ["PRODUCTION_READ", "PRODUCTION_CREATE", "CATALOG_READ"]);

    expect(screen.getByRole("link", { name: "Nova produção" })).toHaveAttribute("href", "/productions/new");

    unmount();
    open(page(), "IN_PROGRESS", ["PRODUCTION_READ"]);

    expect(screen.queryByRole("link", { name: "Nova produção" })).not.toBeInTheDocument();
  });
});
