import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadMoreAvailablePreWeighings, planProductionItem, startProduction } from "@/features/productions/actions";
import { StartProductionPage } from "@/features/productions/StartProductionPage";
import type { PreWeighing, PreWeighingPage, Product } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aPreWeighing, aPreWeighingPlan, aProduct, aProduction } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({
  startProduction: vi.fn(),
  planProductionItem: vi.fn(),
  loadMoreAvailablePreWeighings: vi.fn(),
}));

const BREAD = aProduct({
  sku: "018f0000-0000-7000-8000-000000000090",
  description: "Pão francês",
  unit: "KILOGRAM",
  kind: "MANUFACTURED",
});

const WEIGHED = aPreWeighing({
  id: "018f0000-0000-7000-8000-0000000000a1",
  product: { sku: "018f0000-0000-7000-8000-000000000091", description: "Pão de queijo", unit: "KILOGRAM" },
  quantity: "5",
  createdAt: "2026-10-13T12:00:00.000Z",
});

const page = (items: PreWeighing[] = [WEIGHED], nextCursor: string | null = null): PreWeighingPage => ({
  items,
  nextCursor,
});

function open(products: Product[] = [BREAD], preWeighings: PreWeighingPage = page()) {
  return renderWithProviders(<StartProductionPage products={products} preWeighings={preWeighings} />, {
    route: "/productions/new",
    user: aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE", "CATALOG_READ"] }),
  });
}

async function addItem(quantity = "10,5") {
  await userEvent.selectOptions(screen.getByLabelText("Produto"), BREAD.sku);
  await userEvent.type(screen.getByLabelText("Quantidade a produzir"), quantity);
  await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
}

const preWeighingBox = () => screen.getByRole("checkbox", { name: /^Pão de queijo/ });

beforeEach(() => {
  vi.mocked(startProduction).mockReset();
  vi.mocked(planProductionItem).mockReset();
  vi.mocked(loadMoreAvailablePreWeighings).mockReset();
  vi.mocked(planProductionItem).mockResolvedValue({ ok: true, data: aPreWeighingPlan() });
});

describe("StartProductionPage", () => {
  it("starts a production from the checked pre-weighings and the added items", async () => {
    vi.mocked(startProduction).mockResolvedValue({
      ok: true,
      data: aProduction({ id: "018f0000-0000-7000-8000-0000000000c0" }),
    });
    open();

    await userEvent.click(preWeighingBox());
    await addItem();
    expect(planProductionItem).toHaveBeenCalledWith({ productSku: BREAD.sku, quantity: "10.5" });
    await screen.findByRole("button", { name: "Remover Pão francês" });
    await userEvent.click(screen.getByRole("button", { name: "Iniciar produção" }));

    expect(startProduction).toHaveBeenCalledWith({
      items: [{ preWeighingId: WEIGHED.id }, { productSku: BREAD.sku, quantity: "10.5" }],
    });
    await waitFor(() => expect(navigation.pathname).toBe("/productions/018f0000-0000-7000-8000-0000000000c0"));
  });

  it("does not start a production with nothing in it", () => {
    open();

    expect(screen.getByRole("button", { name: "Iniciar produção" })).toBeDisabled();
  });

  it("shows the inputs an added item plans and warns of what the stock lacks", async () => {
    vi.mocked(planProductionItem).mockResolvedValue({
      ok: true,
      data: aPreWeighingPlan({
        items: [{ ...aPreWeighingPlan().items[0]!, plannedQuantity: "6", shortfall: "1.5" }],
      }),
    });
    open();

    await addItem();

    expect(await screen.findByText("Estoque insuficiente: falta 1,5 kg de Farinha de trigo")).toBeInTheDocument();
    expect(screen.getByText("Farinha de trigo: 6 kg")).toBeInTheDocument();
  });

  it("does not add an item whose plan is refused", async () => {
    vi.mocked(planProductionItem).mockResolvedValue({ ok: false, status: 409, message: "No recipe." });
    open();

    await addItem();

    expect(await screen.findByRole("alert")).toHaveTextContent("o produto não tem receita");
    expect(screen.queryByRole("button", { name: "Remover Pão francês" })).not.toBeInTheDocument();
  });

  it("removes an added item", async () => {
    open();

    await addItem();
    await userEvent.click(await screen.findByRole("button", { name: "Remover Pão francês" }));

    expect(screen.queryByRole("button", { name: "Remover Pão francês" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar produção" })).toBeDisabled();
  });

  it("explains a pre-weighing taken meanwhile and unchecks it", async () => {
    vi.mocked(startProduction).mockResolvedValue({ ok: false, status: 409, message: "Taken." });
    open();

    await userEvent.click(preWeighingBox());
    await userEvent.click(screen.getByRole("button", { name: "Iniciar produção" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Uma pré-pesagem já está em outra produção ou a receita mudou. A lista foi atualizada.",
    );
    expect(preWeighingBox()).not.toBeChecked();
  });

  it("drops the pre-weighings loaded later when a start is refused, so none of them is offered stale", async () => {
    const later = aPreWeighing({
      id: "018f0000-0000-7000-8000-0000000000a2",
      product: { sku: "sku-9", description: "Bolo", unit: "UNIT" },
    });
    vi.mocked(loadMoreAvailablePreWeighings).mockResolvedValue({ ok: true, data: page([later], null) });
    vi.mocked(startProduction).mockResolvedValue({ ok: false, status: 409, message: "Taken." });
    open([BREAD], page([WEIGHED], "c-1"));

    await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /^Bolo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Iniciar produção" }));

    await screen.findByRole("alert");
    expect(screen.queryByRole("checkbox", { name: /^Bolo/ })).not.toBeInTheDocument();
  });

  it("says when no pre-weighing is available", () => {
    open([BREAD], page([]));

    expect(screen.getByText("Nenhuma pré-pesagem disponível.")).toBeInTheDocument();
  });

  it("loads more available pre-weighings", async () => {
    vi.mocked(loadMoreAvailablePreWeighings).mockResolvedValue({
      ok: true,
      data: page(
        [
          aPreWeighing({
            id: "018f0000-0000-7000-8000-0000000000a2",
            product: { sku: "sku-9", description: "Bolo", unit: "UNIT" },
          }),
        ],
        null,
      ),
    });
    open([BREAD], page([WEIGHED], "c-1"));

    await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));

    expect(loadMoreAvailablePreWeighings).toHaveBeenCalledWith("c-1");
    expect(await screen.findByRole("checkbox", { name: /^Bolo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });
});
