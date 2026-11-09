import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProduct, updateProduct } from "@/features/products/actions";
import { ProductsListPage } from "@/features/products/ProductsListPage";
import { saveRecipe } from "@/features/recipes/actions";
import type { Permission, Product } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";
import { columnHeaders } from "@/tests/table-layouts";
import { aCurrentUser, aPackaging, aProduct, aRecipe } from "@/tests/samples";
import { chooseRowAction } from "@/tests/row-actions";

vi.mock("@/features/products/actions", () => ({ createProduct: vi.fn(), updateProduct: vi.fn() }));
vi.mock("@/features/recipes/actions", () => ({ readRecipe: vi.fn(), saveRecipe: vi.fn() }));

const createMock = vi.mocked(createProduct);
const updateMock = vi.mocked(updateProduct);
const saveRecipeMock = vi.mocked(saveRecipe);

const BREAD = aProduct({
  sku: "018f0000-0000-7000-8000-000000000090",
  description: "Pão francês",
  kind: "MANUFACTURED",
});
const FLOUR = aProduct();

interface RenderOptions {
  products?: Product[];
  catalog?: Product[];
  permissions?: Permission[];
  route?: string;
  tableLayouts?: { tableKey: string; order: string[]; widths: Record<string, number> }[];
}

function renderPage({
  products = [FLOUR],
  catalog = products,
  permissions = ["CATALOG_READ", "CATALOG_CREATE"],
  route = "/products",
  tableLayouts = [],
}: RenderOptions = {}) {
  return renderWithProviders(<ProductsListPage products={products} catalog={catalog} />, {
    route,
    user: aCurrentUser({ permissions }),
    tableLayouts,
  });
}

/** Registers `product` through the dialog, with the server answering as if it had just been created. */
async function register(product: typeof BREAD, permissions: Permission[]) {
  createMock.mockResolvedValue({ ok: true, data: product });

  renderPage({ products: [FLOUR], catalog: [FLOUR, product], permissions });

  await userEvent.click(await screen.findByRole("button", { name: "Novo produto" }));
  await userEvent.type(await screen.findByLabelText("Descrição", { selector: "input" }), product.description);
  await userEvent.selectOptions(
    screen.getByLabelText("Tipo", { selector: "select" }),
    product.kind === "GOODS" ? "Mercadoria" : "Fabricado",
  );
  await userEvent.selectOptions(screen.getByLabelText("Unidade", { selector: "select" }), "Quilograma (kg)");
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
}

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ ok: true, data: FLOUR });
  updateMock.mockReset();
  saveRecipeMock.mockReset().mockResolvedValue({ ok: true, data: aRecipe() });
});

describe("ProductsListPage", () => {
  it("lists each product with its kind, unit, packagings and status in Portuguese", async () => {
    renderPage({
      products: [
        aProduct({
          sku: "sku-1",
          description: "Farinha de trigo",
          packagings: [
            aPackaging({ id: "p-1", content: "0.38" }),
            aPackaging({ id: "p-2", content: "1" }),
            aPackaging({ id: "p-3", content: "5", isActive: false }),
          ],
        }),
        aProduct({ sku: "sku-2", description: "Pão", kind: "MANUFACTURED", unit: "UNIT", isActive: false }),
      ],
    });

    const flour = within((await screen.findByText("Farinha de trigo")).closest("tr")!);
    expect(flour.getByText("Mercadoria")).toBeInTheDocument();
    expect(flour.getByText("kg")).toBeInTheDocument();
    expect(flour.getByText("380 g · 1 kg")).toBeInTheDocument();
    expect(flour.getByText("Ativo")).toBeInTheDocument();

    const bread = within(screen.getByText("Pão").closest("tr")!);
    expect(bread.getByText("Fabricado")).toBeInTheDocument();
    expect(bread.getByText("un")).toBeInTheDocument();
    expect(bread.getByText("—")).toBeInTheDocument();
    expect(bread.getByText("Inativo")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Embalagens" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "GTIN" })).not.toBeInTheDocument();
  });

  it("says there is no active product instead of showing a bare table", async () => {
    renderPage({ products: [] });

    expect(await screen.findByText("Nenhum produto ativo.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("hides the registration from whoever may only read the catalog", async () => {
    renderPage({ permissions: ["CATALOG_READ"] });

    await screen.findByText("Farinha de trigo");
    expect(screen.queryByRole("button", { name: "Novo produto" })).not.toBeInTheDocument();
  });

  it("offers the registration as an icon button in the row of the count", async () => {
    renderPage();

    const create = await screen.findByRole("button", { name: "Novo produto" });
    expect(create).toHaveTextContent("");
    expect(create.closest("div")).toContainElement(screen.getByText("1 produto"));
  });

  it("still offers the registration when the list is empty", async () => {
    renderPage({ products: [], route: "/products?q=zzz" });

    await screen.findByText("Nenhum produto encontrado para estes filtros.");
    expect(screen.getByRole("button", { name: "Novo produto" })).toBeInTheDocument();
  });

  it("registers a product from the list and closes the dialog", async () => {
    renderPage({ products: [] });

    await userEvent.click(await screen.findByRole("button", { name: "Novo produto" }));
    await userEvent.type(await screen.findByLabelText("Descrição"), "Fermento");
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "Mercadoria");
    await userEvent.selectOptions(screen.getByLabelText("Unidade", { selector: "select" }), "Quilograma (kg)");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        description: "FERMENTO",
        kind: "GOODS",
        unit: "KILOGRAM",
        isStorableOnceOpened: true,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens the recipe of a manufactured product as soon as it is registered", async () => {
    await register(BREAD, ["CATALOG_READ", "CATALOG_CREATE", "CATALOG_UPDATE"]);

    const dialog = within(await screen.findByRole("dialog", { name: "Nova receita de Pão francês" }));
    expect(screen.queryByRole("dialog", { name: "Novo produto" })).not.toBeInTheDocument();

    await userEvent.type(dialog.getByLabelText("Rendimento (kg)"), "10");
    await userEvent.selectOptions(dialog.getByLabelText("Ingrediente 1"), "Farinha de trigo (kg)");
    await userEvent.type(dialog.getByLabelText("Quantidade do ingrediente 1"), "6");
    await userEvent.click(dialog.getByRole("button", { name: "Salvar receita" }));

    await waitFor(() =>
      expect(saveRecipeMock).toHaveBeenCalledWith(BREAD.sku, {
        yieldQuantity: "10",
        ingredients: [{ productSku: FLOUR.sku, quantity: "6" }],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("lets the recipe of the product just registered be left for later", async () => {
    await register(BREAD, ["CATALOG_READ", "CATALOG_CREATE", "CATALOG_UPDATE"]);

    const dialog = within(await screen.findByRole("dialog", { name: "Nova receita de Pão francês" }));
    await userEvent.click(dialog.getByRole("button", { name: "Deixar para depois" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("asks for no recipe after registering a product that is not manufactured", async () => {
    await register(aProduct({ sku: "sku-9", description: "Fermento" }), [
      "CATALOG_READ",
      "CATALOG_CREATE",
      "CATALOG_UPDATE",
    ]);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // The recipe is saved with a permission the registration does not need.
  it("asks for no recipe from whoever may not edit the catalog", async () => {
    await register(BREAD, ["CATALOG_READ", "CATALOG_CREATE"]);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("hides editing and deactivating from whoever may not edit the catalog", async () => {
    renderPage({ permissions: ["CATALOG_READ", "CATALOG_CREATE"] });

    await screen.findByText("Farinha de trigo");
    expect(screen.queryByRole("button", { name: "Ações de Farinha de trigo" })).not.toBeInTheDocument();
  });

  it("opens the product to be edited and sends the edit", async () => {
    updateMock.mockImplementation(async (_sku, body) => ({ ok: true, data: { ...FLOUR, ...body } as Product }));
    renderPage({ permissions: ["CATALOG_READ", "CATALOG_UPDATE"] });

    await chooseRowAction("Ações de Farinha de trigo", "Editar");
    const dialog = within(await screen.findByRole("dialog", { name: "Editar produto" }));
    await userEvent.clear(dialog.getByLabelText("Descrição"));
    await userEvent.type(dialog.getByLabelText("Descrição"), "Farinha integral");
    await userEvent.click(dialog.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(FLOUR.sku, {
        description: "FARINHA INTEGRAL",
        isStorableOnceOpened: true,
        minimumQuantity: null,
        packagings: [],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("deactivates a product and activates it again", async () => {
    updateMock.mockImplementation(async (_sku, body) => ({ ok: true, data: { ...FLOUR, ...body } as Product }));
    const { rerender } = renderPage({ permissions: ["CATALOG_READ", "CATALOG_UPDATE"] });

    await chooseRowAction("Ações de Farinha de trigo", "Inativar");
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(FLOUR.sku, { isActive: false }));

    // The server reads the list again after the change; here the page is handed the new rows.
    const inactive = { ...FLOUR, isActive: false };
    rerender(<ProductsListPage products={[inactive]} catalog={[inactive]} />);
    expect(await screen.findByText("Inativo")).toBeInTheDocument();

    await chooseRowAction("Ações de Farinha de trigo", "Reativar");
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(FLOUR.sku, { isActive: true }));
    expect(updateMock.mock.calls.map(([, body]) => body)).toEqual([{ isActive: false }, { isActive: true }]);
  });
});

/** The query string the address holds, as the server would read the filters from it. */
const query = () => [...new URLSearchParams(navigation.search)];

describe("ProductsListPage filters", () => {
  it("opens on the active products when nothing was chosen", async () => {
    renderPage();

    await screen.findByText("Farinha de trigo");
    expect(query()).toEqual([]);
    expect(screen.getByRole("button", { name: "Situação: Ativos" })).toBeInTheDocument();
  });

  it("searches by description or GTIN only when Consultar is pressed", async () => {
    renderPage();

    await userEvent.type(await screen.findByRole("searchbox", { name: "Buscar produtos" }), "pão");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(query()).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Consultar" }));

    await waitFor(() => expect(query()).toEqual([["q", "pão"]]));
  });

  it("filters by kind, and by more than one unit at once", async () => {
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Tipo" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Fabricado" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Unidade" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Quilograma (kg)" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Grama (g)" }));
    await userEvent.keyboard("{Escape}");
    expect(query()).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Consultar" }));

    await waitFor(() =>
      expect(query()).toEqual([
        ["kind", "MANUFACTURED"],
        ["unit", "KILOGRAM"],
        ["unit", "GRAM"],
      ]),
    );
    expect(screen.getByRole("button", { name: "Tipo: Fabricado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unidade: 2 opções" })).toBeInTheDocument();
  });

  it("asks for the inactive products, or every product, when asked", async () => {
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Situação: Ativos" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Inativos" }));
    await userEvent.click(screen.getByRole("button", { name: "Consultar" }));
    await waitFor(() => expect(query()).toEqual([["status", "INACTIVE"]]));

    await userEvent.click(screen.getByRole("button", { name: "Situação: Inativos" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Todos" }));
    await userEvent.click(screen.getByRole("button", { name: "Consultar" }));
    await waitFor(() => expect(query()).toEqual([["status", "ALL"]]));
  });

  it("runs the search when Enter is pressed in the search field", async () => {
    renderPage();

    await userEvent.type(await screen.findByRole("searchbox", { name: "Buscar produtos" }), "pão de forma{Enter}");

    await waitFor(() => expect(query()).toEqual([["q", "pão de forma"]]));
  });

  it("discards filters chosen but not yet queried when they are cleared", async () => {
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Tipo" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Fabricado" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));

    expect(screen.getByRole("button", { name: "Tipo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).not.toBeInTheDocument();
    expect(query()).toEqual([]);
  });

  it("opens with the filters the address carries, so a link shows the same list", async () => {
    renderPage({ route: "/products?q=farinha&kind=GOODS&status=INACTIVE" });

    await screen.findByText("Farinha de trigo");
    expect(screen.getByRole("searchbox", { name: "Buscar produtos" })).toHaveValue("farinha");
    expect(screen.getByRole("button", { name: "Tipo: Mercadoria" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Situação: Inativos" })).toBeInTheDocument();
  });

  it("says when nothing matches the filters, and clears them back to the active products", async () => {
    renderPage({ products: [], route: "/products?q=zzz&unit=LITER" });

    expect(await screen.findByText("Nenhum produto encontrado para estes filtros.")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0]!);

    await waitFor(() => expect(navigation.url).toBe("/products"));
    expect(screen.getByRole("searchbox", { name: "Buscar produtos" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).not.toBeInTheDocument();
  });

  it("counts the products it lists", async () => {
    renderPage({ products: [FLOUR, BREAD] });

    expect(await screen.findByText("2 produtos")).toBeInTheDocument();
  });
});

describe("ProductsListPage layout", () => {
  it("gives the table the height left on the screen", async () => {
    renderPage();

    await screen.findByText("Farinha de trigo");
    expect(screen.getByRole("table").parentElement).toHaveAttribute("data-fill", "true");
  });
});

describe("ProductsListPage columns", () => {
  it("lets the actions column be moved and resized like any other", async () => {
    renderPage({ permissions: ["CATALOG_READ", "CATALOG_UPDATE"] });

    expect(await screen.findByRole("button", { name: "Mover coluna Ações" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Redimensionar coluna Ações" })).toBeInTheDocument();
  });

  it("shows the columns in the order the user arranged them", async () => {
    renderPage({ tableLayouts: [{ tableKey: "products", order: ["kind", "description"], widths: {} }] });

    await waitFor(() => expect(columnHeaders()[0]).toBe("Tipo"));
  });
});
