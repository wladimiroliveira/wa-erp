import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planProductionItem, startProduction } from "@/features/productions/actions";
import { StartProductionPage } from "@/features/productions/StartProductionPage";
import type { Product, StartCandidate } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aPreWeighingPlan, aProduct, aProduction, aStartCandidate } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({
  startProduction: vi.fn(),
  planProductionItem: vi.fn(),
}));

const BREAD = aProduct({
  sku: "018f0000-0000-7000-8000-000000000090",
  description: "Pão francês",
  unit: "KILOGRAM",
  kind: "MANUFACTURED",
});

const sku = (n: number) => `018f0000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;

const FILLING = aStartCandidate({
  id: "018f0000-0000-7000-8000-0000000000a2",
  product: { sku: sku(2), description: "Recheio", unit: "KILOGRAM" },
  quantity: "0.7",
});
const CONE = aStartCandidate({
  id: "018f0000-0000-7000-8000-0000000000a3",
  product: { sku: sku(3), description: "Casquinha", unit: "UNIT" },
  quantity: "20",
});
const BONBON = aStartCandidate({
  id: "018f0000-0000-7000-8000-0000000000a1",
  product: { sku: sku(1), description: "Bombom", unit: "UNIT" },
  quantity: "20",
  stages: [FILLING, CONE],
});
const BREAD_BAKE = aStartCandidate({
  id: "018f0000-0000-7000-8000-0000000000a4",
  product: { sku: sku(4), description: "Pão de queijo", unit: "KILOGRAM" },
  quantity: "5",
});

function open(products: Product[] = [BREAD], candidates: StartCandidate[] = [BONBON, BREAD_BAKE]) {
  return renderWithProviders(<StartProductionPage products={products} candidates={candidates} />, {
    route: "/productions/new",
    user: aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE", "CATALOG_READ"] }),
  });
}

const chooseGuided = () => userEvent.click(screen.getByRole("radio", { name: "Com pré-pesagem" }));
const chooseFree = () => userEvent.click(screen.getByRole("radio", { name: "Sem pré-pesagem" }));
const root = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) });

async function addItem(quantity = "10,5") {
  await userEvent.selectOptions(screen.getByLabelText("Produto"), BREAD.sku);
  await userEvent.type(screen.getByLabelText("Quantidade a produzir"), quantity);
  await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
}

beforeEach(() => {
  vi.mocked(startProduction).mockReset();
  vi.mocked(planProductionItem).mockReset();
  vi.mocked(planProductionItem).mockResolvedValue({ ok: true, data: aPreWeighingPlan() });
});

describe("StartProductionPage", () => {
  it("leaves the way back to the breadcrumbs", () => {
    open();

    expect(screen.queryByRole("link", { name: /^Voltar/ })).not.toBeInTheDocument();
  });

  it("shows neither form before the operator chooses", () => {
    open();

    expect(screen.getByRole("radio", { name: "Com pré-pesagem" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Sem pré-pesagem" })).not.toBeChecked();
    expect(screen.queryByLabelText("Produto")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /^Bombom/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Iniciar produção" })).not.toBeInTheDocument();
  });

  it("lists the candidates as a tree, the stages under their root without a control", async () => {
    open();

    await chooseGuided();

    expect(root("Bombom")).toBeInTheDocument();
    expect(root("Pão de queijo")).toBeInTheDocument();
    expect(screen.getByText("Recheio — 0,7 kg")).toBeInTheDocument();
    expect(screen.getByText(/^Casquinha — /)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /^Recheio/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio", { name: /^(Bombom|Pão de queijo)/ })).toHaveLength(2);
  });

  it("starts a guided production from the chosen root", async () => {
    vi.mocked(startProduction).mockResolvedValue({
      ok: true,
      data: aProduction({ id: "018f0000-0000-7000-8000-0000000000c0" }),
    });
    open();

    await chooseGuided();
    expect(screen.getByRole("button", { name: "Iniciar produção" })).toBeDisabled();
    await userEvent.click(root("Bombom"));
    await userEvent.click(screen.getByRole("button", { name: "Iniciar produção" }));

    expect(startProduction).toHaveBeenCalledWith({ preWeighingId: BONBON.id });
    await waitFor(() => expect(navigation.pathname).toBe("/productions/018f0000-0000-7000-8000-0000000000c0"));
  });

  it("hides the tree and keeps no root checked when switching to the free mode", async () => {
    open();

    await chooseGuided();
    await userEvent.click(root("Bombom"));
    await chooseFree();

    expect(screen.queryByRole("radio", { name: /^Bombom/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Produto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar produção" })).toBeDisabled();

    await chooseGuided();

    expect(root("Bombom")).not.toBeChecked();
  });

  it("starts a free production from the added items", async () => {
    vi.mocked(startProduction).mockResolvedValue({
      ok: true,
      data: aProduction({ id: "018f0000-0000-7000-8000-0000000000c0" }),
    });
    open();

    await chooseFree();
    await addItem();
    expect(planProductionItem).toHaveBeenCalledWith({ productSku: BREAD.sku, quantity: "10.5" });
    await screen.findByRole("button", { name: "Remover Pão francês" });
    await userEvent.click(screen.getByRole("button", { name: "Iniciar produção" }));

    expect(startProduction).toHaveBeenCalledWith({
      items: [{ productSku: BREAD.sku, quantity: "10.5", produce: [] }],
    });
  });

  it("does not start a free production with nothing in it", async () => {
    open();

    await chooseFree();

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

    await chooseFree();
    await addItem();

    expect(await screen.findByText("Estoque insuficiente: falta 1,5 kg de Farinha de trigo")).toBeInTheDocument();
    expect(screen.getByText("Farinha de trigo: 6 kg")).toBeInTheDocument();
  });

  it("does not add an item whose plan is refused", async () => {
    vi.mocked(planProductionItem).mockResolvedValue({ ok: false, status: 409, message: "No recipe." });
    open();

    await chooseFree();
    await addItem();

    expect(await screen.findByRole("alert")).toHaveTextContent("o produto não tem receita");
    expect(screen.queryByRole("button", { name: "Remover Pão francês" })).not.toBeInTheDocument();
  });

  it("removes an added item", async () => {
    open();

    await chooseFree();
    await addItem();
    await userEvent.click(await screen.findByRole("button", { name: "Remover Pão francês" }));

    expect(screen.queryByRole("button", { name: "Remover Pão francês" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar produção" })).toBeDisabled();
  });

  it("explains a pre-weighing taken meanwhile and unchooses it", async () => {
    vi.mocked(startProduction).mockResolvedValue({ ok: false, status: 409, message: "Taken." });
    open();

    await chooseGuided();
    await userEvent.click(root("Bombom"));
    await userEvent.click(screen.getByRole("button", { name: "Iniciar produção" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A pré-pesagem já foi usada em outra produção ou a receita mudou. A lista foi atualizada.",
    );
    expect(root("Bombom")).not.toBeChecked();
  });

  it("says when no pre-weighing is pending", async () => {
    open([BREAD], []);

    await chooseGuided();

    expect(screen.getByText("Nenhuma pré-pesagem pendente.")).toBeInTheDocument();
  });
});

describe("StartProductionPage, intermediates of a free item", () => {
  const product = (sku: string, description: string, unit: "KILOGRAM" | "UNIT" = "KILOGRAM") => ({
    sku,
    description,
    unit,
  });
  const FILLING = product("018f0000-0000-7000-8000-0000000000f1", "Recheio");
  const SHELL = product("018f0000-0000-7000-8000-0000000000f2", "Casquinha", "UNIT");
  const TEMPERED = product("018f0000-0000-7000-8000-0000000000f3", "Chocolate temperado");
  const MILK = product("018f0000-0000-7000-8000-0000000000f4", "Leite condensado");
  const bought = (item: ReturnType<typeof product>, plannedQuantity: string, shortfall = "0") => ({
    product: item,
    plannedQuantity,
    lots: [],
    shortfall,
    manufactured: null,
  });

  const planWith = (fillingToProduce: string) =>
    aPreWeighingPlan({
      product: { sku: BREAD.sku, description: BREAD.description, unit: BREAD.unit },
      quantity: "10.5",
      items: [
        {
          ...bought(FILLING, "1"),
          shortfall: "0.7",
          manufactured: {
            needed: "1",
            inStock: "0.3",
            toProduce: fillingToProduce,
            stage: aPreWeighingPlan({
              product: FILLING,
              quantity: fillingToProduce,
              items: [bought(MILK, fillingToProduce, "0.2")],
            }),
          },
        },
        {
          ...bought(SHELL, "50"),
          shortfall: "50",
          manufactured: {
            needed: "50",
            inStock: "0",
            toProduce: "50",
            stage: aPreWeighingPlan({
              product: SHELL,
              quantity: "50",
              items: [
                {
                  ...bought(TEMPERED, "0.5"),
                  shortfall: "0.5",
                  manufactured: { needed: "0.5", inStock: "0", toProduce: "0.5", stage: null },
                },
              ],
            }),
          },
        },
      ],
    });

  async function addBombom() {
    vi.mocked(planProductionItem).mockResolvedValue({ ok: true, data: planWith("0.7") });
    open();
    await chooseFree();
    await addItem();
    return screen.findByLabelText("A fabricar de Recheio");
  }

  it("shows each intermediate with what is needed, in stock and to make", async () => {
    const field = await addBombom();

    expect(field).toHaveValue("0,7");
    expect(screen.getByLabelText("A fabricar de Casquinha")).toHaveValue("50");
    expect(screen.getByLabelText("A fabricar de Chocolate temperado")).toHaveValue("0,5");
  });

  it("plans the item again with the quantity to make typed", async () => {
    const field = await addBombom();
    vi.mocked(planProductionItem).mockResolvedValue({ ok: true, data: planWith("1") });

    await userEvent.clear(field);
    await userEvent.type(field, "1");

    await waitFor(
      () =>
        expect(planProductionItem).toHaveBeenLastCalledWith(
          { productSku: BREAD.sku, quantity: "10.5" },
          { [FILLING.sku]: "1" },
        ),
      { timeout: 2000 },
    );
  });

  it("keeps an earlier quantity to make when another one is typed", async () => {
    await addBombom();
    const shellAtZero = planWith("0.7");
    shellAtZero.items[1] = {
      ...shellAtZero.items[1]!,
      manufactured: { ...shellAtZero.items[1]!.manufactured!, toProduce: "0", stage: null },
    };
    vi.mocked(planProductionItem).mockResolvedValue({ ok: true, data: shellAtZero });

    await userEvent.clear(screen.getByLabelText("A fabricar de Casquinha"));
    await userEvent.type(screen.getByLabelText("A fabricar de Casquinha"), "0");
    await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar produção" })).toBeEnabled(), {
      timeout: 2000,
    });

    await userEvent.clear(screen.getByLabelText("A fabricar de Recheio"));
    await userEvent.type(screen.getByLabelText("A fabricar de Recheio"), "1");

    await waitFor(
      () =>
        expect(planProductionItem).toHaveBeenLastCalledWith(
          { productSku: BREAD.sku, quantity: "10.5" },
          { [SHELL.sku]: "0", [FILLING.sku]: "1" },
        ),
      { timeout: 2000 },
    );
  });

  it("does not start while a quantity to make waits to be planned", async () => {
    const field = await addBombom();

    await userEvent.clear(field);
    await userEvent.type(field, "1");

    expect(screen.getByRole("button", { name: "Iniciar produção" })).toBeDisabled();
  });

  it("does not start with a quantity to make the unit does not allow", async () => {
    await addBombom();

    await userEvent.clear(screen.getByLabelText("A fabricar de Casquinha"));
    await userEvent.type(screen.getByLabelText("A fabricar de Casquinha"), "2,5");

    expect(await screen.findByText("Informe uma quantidade inteira.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar produção" })).toBeDisabled();
  });

  it("starts with what the plan on screen makes of each intermediate, at any depth", async () => {
    vi.mocked(startProduction).mockResolvedValue({ ok: true, data: aProduction() });
    await addBombom();

    await userEvent.click(screen.getByRole("button", { name: "Iniciar produção" }));

    expect(startProduction).toHaveBeenCalledWith({
      items: [
        {
          productSku: BREAD.sku,
          quantity: "10.5",
          produce: [
            { productSku: FILLING.sku, quantity: "0.7" },
            { productSku: SHELL.sku, quantity: "50" },
            { productSku: TEMPERED.sku, quantity: "0.5" },
          ],
        },
      ],
    });
  });

  it("keeps the plan and holds the start back when planning a quantity to make is refused", async () => {
    const field = await addBombom();
    vi.mocked(planProductionItem).mockResolvedValue({ ok: false, status: 409, message: "Out of range." });

    await userEvent.clear(field);
    await userEvent.type(field, "1");

    expect(await screen.findByRole("alert", {}, { timeout: 2000 })).toHaveTextContent(/^Não foi possível calcular/);
    expect(screen.getByLabelText("A fabricar de Casquinha")).toHaveValue("50");
    expect(screen.getByRole("button", { name: "Iniciar produção" })).toBeDisabled();
  });

  it("warns of what the stock lacks of a bought ingredient inside a stage", async () => {
    await addBombom();

    expect(screen.getByText("Estoque insuficiente: falta 0,2 kg de Leite condensado")).toBeInTheDocument();
  });
});
