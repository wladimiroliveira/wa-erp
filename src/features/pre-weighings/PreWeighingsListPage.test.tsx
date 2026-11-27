import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadMorePreWeighings } from "@/features/pre-weighings/actions";
import type { PreWeighingFilter } from "@/features/pre-weighings/status-filter";
import { PreWeighingsListPage } from "@/features/pre-weighings/PreWeighingsListPage";
import type { Permission, PreWeighing, PreWeighingPage } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { renderWithProviders, type RenderOptions } from "@/tests/render";
import { columnHeaders } from "@/tests/table-layouts";
import { aCurrentUser, aPreWeighing } from "@/tests/samples";

vi.mock("@/features/pre-weighings/actions", () => ({ loadMorePreWeighings: vi.fn() }));

const page = (items: PreWeighing[] = [aPreWeighing()], nextCursor: string | null = null): PreWeighingPage => ({
  items,
  nextCursor,
});

function open(
  listing: PreWeighingPage = page(),
  permissions: Permission[] = ["PRODUCTION_READ"],
  options: RenderOptions = {},
  view: { filter?: PreWeighingFilter; staleOnly?: boolean; staleCount?: number } = {},
) {
  return renderWithProviders(
    <PreWeighingsListPage
      page={listing}
      filter={view.filter ?? "all"}
      staleOnly={view.staleOnly ?? false}
      staleCount={view.staleCount ?? 0}
    />,
    {
      user: aCurrentUser({ permissions }),
      ...options,
    },
  );
}

beforeEach(() => {
  vi.mocked(loadMorePreWeighings).mockReset();
});

describe("PreWeighingsListPage", () => {
  it("lists each pre-weighing with its date, product, quantity and how many ingredients it took", () => {
    open(
      page([
        aPreWeighing({
          id: "pre-weighing-1",
          quantity: "10.5",
          createdAt: "2026-10-02T12:00:00.000Z",
          items: [
            aPreWeighing().items[0]!,
            { ...aPreWeighing().items[0]!, product: { sku: "sku-2", description: "Sal", unit: "GRAM" } },
          ],
        }),
      ]),
    );

    const [, row] = screen.getAllByRole("row");

    expect(within(row!).getByText(/^02\/10\/2026/)).toBeInTheDocument();
    expect(within(row!).getByRole("link", { name: "Pão francês" })).toHaveAttribute(
      "href",
      "/pre-weighings/pre-weighing-1",
    );
    expect(within(row!).getByText("10,5 kg")).toBeInTheDocument();
    expect(within(row!).getByText("2")).toBeInTheDocument();
  });

  it("says nothing was weighed yet instead of showing a bare table", () => {
    open(page([]));

    expect(screen.getByText("Nenhuma pré-pesagem registrada.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("loads the older pre-weighings on request, until there are no more", async () => {
    vi.mocked(loadMorePreWeighings).mockResolvedValue({
      ok: true,
      data: page(
        [
          aPreWeighing({
            id: "pre-weighing-1",
            product: { sku: "sku-9", description: "Pão de queijo", unit: "KILOGRAM" },
          }),
        ],
        null,
      ),
    });
    open(page([aPreWeighing({ id: "pre-weighing-2" })], "pre-weighing-2"));

    await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));

    expect(await screen.findByRole("link", { name: "Pão de queijo" })).toBeInTheDocument();
    expect(loadMorePreWeighings).toHaveBeenCalledWith("pre-weighing-2", { status: undefined, staleOnly: false });
    expect(screen.getByRole("link", { name: "Pão francês" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("offers a new pre-weighing to whoever may record one and read the catalog", () => {
    open(page(), ["PRODUCTION_READ", "PRODUCTION_CREATE", "CATALOG_READ"]);

    expect(screen.getByRole("link", { name: "Nova pré-pesagem" })).toHaveAttribute("href", "/pre-weighings/new");
  });

  it("offers the registration as an icon link in the row of the count", () => {
    open(page(), ["PRODUCTION_READ", "PRODUCTION_CREATE", "CATALOG_READ"]);

    const create = screen.getByRole("link", { name: "Nova pré-pesagem" });
    expect(create).toHaveTextContent("");
    expect(create.closest("div")).toContainElement(screen.getByText("1 pré-pesagem"));
  });

  it("still offers the registration when the list is empty", () => {
    open(page([]), ["PRODUCTION_READ", "PRODUCTION_CREATE", "CATALOG_READ"]);

    expect(screen.getByText("Nenhuma pré-pesagem registrada.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nova pré-pesagem" })).toBeInTheDocument();
  });

  it("leaves the new pre-weighing out for whoever may only read", () => {
    open(page(), ["PRODUCTION_READ", "CATALOG_READ"]);

    expect(screen.getByRole("link", { name: "Pão francês" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nova pré-pesagem" })).not.toBeInTheDocument();
  });
});

describe("PreWeighingsListPage layout", () => {
  it("gives the table the height left on the screen", () => {
    open();

    expect(screen.getByRole("table").parentElement).toHaveAttribute("data-fill", "true");
  });
});

describe("PreWeighingsListPage columns", () => {
  it("shows the columns in the order the user arranged them", async () => {
    open(page(), ["PRODUCTION_READ"], {
      tableLayouts: [{ tableKey: "pre-weighings", order: ["product", "date"], widths: {} }],
    });

    await waitFor(() => expect(columnHeaders()[0]).toBe("Produto"));
  });
});

describe("PreWeighingsListPage sizing", () => {
  it("keeps the link to each pre-weighing as tall as a control", () => {
    open();

    expect(screen.getByRole("link", { name: "Pão francês" })).toHaveClass("min-h-8");
  });
});

describe("PreWeighingsListPage status", () => {
  it.each([
    ["PENDING", "Pendente"],
    ["IN_PRODUCTION", "Em produção"],
    ["PRODUCED", "Produzida"],
    ["DAMAGED", "Avariada"],
  ] as const)("shows %s as %s in the status column", (status, label) => {
    open(page([aPreWeighing({ status })]));

    const [, row] = screen.getAllByRole("row");

    expect(within(row!).getByText(label)).toBeInTheDocument();
  });

  it("filters by status through the address and drops the cursor", async () => {
    open(page(), ["PRODUCTION_READ"], { route: "/pre-weighings?cursor=abc" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "DAMAGED");
    expect(navigation.url).toBe("/pre-weighings?status=DAMAGED");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "all");
    expect(navigation.url).toBe("/pre-weighings");
  });

  it("keeps the filter when loading more", async () => {
    vi.mocked(loadMorePreWeighings).mockResolvedValue({ ok: true, data: page([], null) });
    open(page([aPreWeighing()], "cursor-1"), ["PRODUCTION_READ"], {}, { filter: "PENDING" });

    await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));

    expect(loadMorePreWeighings).toHaveBeenCalledWith("cursor-1", { status: "PENDING", staleOnly: false });
  });
});

describe("PreWeighingsListPage stale warning", () => {
  it("warns of one pending pre-weighing in the singular, with a link to the stale ones", () => {
    open(page(), ["PRODUCTION_READ"], {}, { staleCount: 1 });

    const warning = screen.getByRole("status");

    expect(warning).toHaveTextContent("1 pré-pesagem pendente há mais de 2 dias");
    expect(within(warning).getByRole("link", { name: "Ver" })).toHaveAttribute("href", "/pre-weighings?staleOnly=true");
  });

  it("warns in the plural", () => {
    open(page(), ["PRODUCTION_READ"], {}, { staleCount: 3 });

    expect(screen.getByRole("status")).toHaveTextContent("3 pré-pesagens pendentes há mais de 2 dias");
  });

  it("says the list is narrowed to the stale ones, with a link to clear it", () => {
    open(page(), ["PRODUCTION_READ"], {}, { staleOnly: true, staleCount: 3 });

    const narrowed = screen.getByText("Mostrando pendentes há mais de 2 dias.").parentElement!;

    expect(within(narrowed).getByRole("link", { name: "Limpar" })).toHaveAttribute("href", "/pre-weighings");
  });

  it("does not say the list is narrowed when it is not", () => {
    open(page(), ["PRODUCTION_READ"], {}, { staleCount: 3 });

    expect(screen.queryByText("Mostrando pendentes há mais de 2 dias.")).not.toBeInTheDocument();
  });

  it("shows no warning when none is stale", () => {
    open();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
