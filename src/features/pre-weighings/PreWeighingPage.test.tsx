import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPreWeighing, planPreWeighing } from "@/features/pre-weighings/actions";
import { PreWeighingPage } from "@/features/pre-weighings/PreWeighingPage";
import { createBodyOf } from "@/features/pre-weighings/plan-tree";
import type { Product } from "@/lib/api";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";
import { aPreWeighing, aPreWeighingPlan, aProduct } from "@/tests/samples";

vi.mock("@/features/pre-weighings/actions", () => ({ planPreWeighing: vi.fn(), createPreWeighing: vi.fn() }));

const BREAD = aProduct({
  sku: "018f0000-0000-7000-8000-000000000090",
  description: "Pão francês",
  kind: "MANUFACTURED",
});
const FLOUR = {
  sku: "018f0000-0000-7000-8000-000000000020",
  description: "Farinha de trigo",
  unit: "KILOGRAM",
} as const;
const SALT = { sku: "018f0000-0000-7000-8000-000000000021", description: "Sal", unit: "GRAM" } as const;

const TWO_INGREDIENTS = aPreWeighingPlan({
  items: [
    {
      product: FLOUR,
      plannedQuantity: "6",
      lots: [
        { id: "lot-1", expiresAt: "2099-12-31", quantity: "4.5" },
        { id: "lot-2", expiresAt: null, quantity: "1.5" },
      ],
      shortfall: "0",
      manufactured: null,
    },
    {
      product: SALT,
      plannedQuantity: "120",
      lots: [{ id: "lot-3", expiresAt: null, quantity: "100" }],
      shortfall: "20",
      manufactured: null,
    },
  ],
});

const open = (products: Product[] = [BREAD]) => renderWithProviders(<PreWeighingPage products={products} />);

/** Answers every ask for the plan with `respond`; the mock records what was asked. */
function planning(
  respond: () => Awaited<ReturnType<typeof planPreWeighing>> = () => ({ ok: true, data: TWO_INGREDIENTS }),
) {
  vi.mocked(planPreWeighing).mockImplementation(async () => respond());
}

/** Answers every record with `respond`; the mock records what was sent. */
function recording(
  respond: () => Awaited<ReturnType<typeof createPreWeighing>> = () => ({ ok: true, data: aPreWeighing() }),
) {
  vi.mocked(createPreWeighing).mockImplementation(async () => respond());
}

async function calculate(quantity = "10") {
  await userEvent.selectOptions(await screen.findByLabelText("Produto"), "Pão francês (kg)");
  await userEvent.type(screen.getByLabelText("Quantidade a produzir"), quantity);
  await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
}

async function weigh(flour: string, salt: string) {
  await userEvent.type(await screen.findByLabelText("Pesado de Farinha de trigo"), flour);
  await userEvent.type(screen.getByLabelText("Pesado de Sal"), salt);
}

const record = () => userEvent.click(screen.getByRole("button", { name: "Registrar pré-pesagem" }));

beforeEach(() => {
  vi.mocked(planPreWeighing).mockReset();
  vi.mocked(createPreWeighing).mockReset();
});

describe("PreWeighingPage", () => {
  it("offers each product the server narrowed the catalog to, with its unit", () => {
    open([BREAD, aProduct({ sku: "sku-4", description: "Bolo", kind: "MANUFACTURED", unit: "UNIT" })]);

    expect(screen.getByRole("option", { name: "Pão francês (kg)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bolo (un)" })).toBeInTheDocument();
  });

  it("says there is nothing to pre-weigh when no manufactured product is active", () => {
    open([]);

    expect(screen.getByText("Nenhum produto fabricado ativo cadastrado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Calcular" })).not.toBeInTheDocument();
  });

  it("refuses to calculate with no product and a zero quantity", async () => {
    planning();
    open();

    await userEvent.type(screen.getByLabelText("Quantidade a produzir"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));

    expect(await screen.findByText("Escolha o produto.")).toBeInTheDocument();
    expect(screen.getByText("A quantidade deve ser maior que zero.")).toBeInTheDocument();
    expect(planPreWeighing).not.toHaveBeenCalled();
  });

  it("asks the plan for the quantity with a decimal point", async () => {
    planning();
    open();

    await calculate("10,5");

    await waitFor(() => expect(planPreWeighing).toHaveBeenCalledWith({ productSku: BREAD.sku, quantity: "10.5" }, 20));
  });

  it("shows how much to weigh of each ingredient and the lots to weigh it from", async () => {
    planning();
    open();

    await calculate();

    expect(await screen.findByRole("heading", { name: "Plano para 10 kg de Pão francês" })).toBeInTheDocument();

    const [, flour, salt] = screen.getAllByRole("row");
    expect(within(flour!).getByText("Farinha de trigo")).toBeInTheDocument();
    expect(within(flour!).getByText("6 kg")).toBeInTheDocument();
    expect(within(flour!).getByText("4,5 kg — validade 31/12/2099")).toBeInTheDocument();
    expect(within(flour!).getByText("1,5 kg — sem validade")).toBeInTheDocument();
    expect(within(salt!).getByText("120 g")).toBeInTheDocument();
  });

  it("warns of the ingredient the stock does not cover, without stopping the record", async () => {
    planning();
    recording();
    open();

    await calculate();

    const [, flour, salt] = await screen.findAllByRole("row");
    expect(within(salt!).getByText("Faltam 20 g")).toBeInTheDocument();
    expect(within(flour!).queryByText(/Faltam/)).not.toBeInTheDocument();

    await weigh("6", "100");
    await record();

    await waitFor(() => expect(createPreWeighing).toHaveBeenCalledTimes(1));
  });

  it("says no lot has the ingredient when the stock has none of it", async () => {
    planning(() => ({
      ok: true,
      data: aPreWeighingPlan({
        items: [{ product: SALT, plannedQuantity: "120", lots: [], shortfall: "120", manufactured: null }],
      }),
    }));
    open();

    await calculate();

    const [, salt] = await screen.findAllByRole("row");
    expect(within(salt!).getByText("Nenhum lote com saldo")).toBeInTheDocument();
    expect(within(salt!).getByText("Faltam 120 g")).toBeInTheDocument();
  });

  it("starts every weighed quantity blank, for the operator to type what the scale showed", async () => {
    planning();
    open();

    await calculate();

    expect(await screen.findByLabelText("Pesado de Farinha de trigo")).toHaveValue("");
    expect(screen.getByLabelText("Pesado de Sal")).toHaveValue("");
  });

  it("refuses to record while an ingredient has no weighed quantity", async () => {
    planning();
    recording();
    open();

    await calculate();
    await userEvent.type(await screen.findByLabelText("Pesado de Farinha de trigo"), "6");
    await record();

    expect(await screen.findByText("Informe o pesado, com até 3 casas decimais.")).toBeInTheDocument();
    expect(createPreWeighing).not.toHaveBeenCalled();
  });

  it("records what was weighed of each ingredient, with decimal points", async () => {
    planning();
    recording();
    open();

    await calculate("10,5");
    await weigh("6,05", "118,5");
    await record();

    await waitFor(() =>
      expect(createPreWeighing).toHaveBeenCalledWith({
        productSku: BREAD.sku,
        quantity: "10.5",
        items: [
          { productSku: FLOUR.sku, weighedQuantity: "6.05" },
          { productSku: SALT.sku, weighedQuantity: "118.5" },
        ],
        stages: [],
      }),
    );
  });

  it("confirms the record, leads to it and clears the screen for the next one", async () => {
    planning();
    recording(() => ({ ok: true, data: aPreWeighing({ id: "pre-weighing-1", quantity: "10" }) }));
    open();

    await calculate();
    await weigh("6", "120");
    await record();

    const result = within(await screen.findByRole("status"));
    expect(result.getByText("Pré-pesagem registrada: 10 kg de Pão francês.")).toBeInTheDocument();
    expect(result.getByRole("link", { name: "Ver a pré-pesagem" })).toHaveAttribute(
      "href",
      "/pre-weighings/pre-weighing-1",
    );
    expect(screen.getByLabelText("Produto")).toHaveValue("");
    expect(screen.getByLabelText("Quantidade a produzir")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Registrar pré-pesagem" })).not.toBeInTheDocument();
  });

  it("says why there is no plan when the product cannot be pre-weighed, without offering to try again", async () => {
    planning(() => ({ ok: false, status: 409, message: "Product has no recipe." }));
    open();

    await calculate();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível calcular: o produto não tem receita, a receita usa um produto inativo ou a quantidade está fora do que a receita alcança.",
    );
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantidade a produzir")).toHaveValue("10");
  });

  it("explains a plan that failed to come back, keeping what was typed", async () => {
    vi.mocked(planPreWeighing).mockRejectedValue(new Error("fetch failed"));
    open();

    await calculate();

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível concluir a operação. Tente de novo.");
    expect(screen.getByLabelText("Quantidade a produzir")).toHaveValue("10");
  });

  it("asks the stock again, and blanks what was weighed, when the same plan is calculated twice", async () => {
    planning();
    open();

    await calculate();
    await userEvent.type(await screen.findByLabelText("Pesado de Sal"), "120");
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));

    await waitFor(() => expect(planPreWeighing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("Pesado de Sal")).toHaveValue(""));
  });

  it("says the recipe changed since the plan, in Portuguese, and keeps what was weighed", async () => {
    planning();
    recording(() => ({
      ok: false,
      status: 409,
      message: "The items do not match the ingredients of the recipe.",
    }));
    open();

    await calculate();
    await weigh("6", "120");
    await record();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A receita ou o produto mudou desde que o plano foi calculado. Calcule de novo.",
    );
    expect(screen.getByLabelText("Pesado de Sal")).toHaveValue("120");
  });
});

describe("PreWeighingPage sizing", () => {
  it("keeps the way back and the link to the record as tall as a control", async () => {
    planning();
    recording(() => ({ ok: true, data: aPreWeighing({ id: "pre-weighing-1", quantity: "10" }) }));
    open();
    expect(screen.getByRole("link", { name: "Voltar para as pré-pesagens" })).toHaveClass("min-h-8");

    await calculate();
    await weigh("6", "120");
    await record();

    expect(await screen.findByRole("link", { name: "Ver a pré-pesagem" })).toHaveClass("min-h-8");
  });
});

describe("PreWeighingPage, unit of each weighing", () => {
  const YEAST = { sku: "018f0000-0000-7000-8000-000000000022", description: "Fermento", unit: "KILOGRAM" } as const;
  const EGG = { sku: "018f0000-0000-7000-8000-000000000023", description: "Ovo", unit: "UNIT" } as const;

  const WITH_SMALL = aPreWeighingPlan({
    items: [
      {
        product: FLOUR,
        plannedQuantity: "6",
        lots: [{ id: "lot-1", expiresAt: null, quantity: "6" }],
        shortfall: "0",
        manufactured: null,
      },
      {
        product: YEAST,
        plannedQuantity: "0.0123456",
        lots: [{ id: "lot-2", expiresAt: null, quantity: "0.01" }],
        shortfall: "0.0023456",
        manufactured: null,
      },
      { product: EGG, plannedQuantity: "4", lots: [], shortfall: "4", manufactured: null },
    ],
  });

  const rowOf = (description: string) => within(screen.getByText(description).closest("tr")!);
  const unitOf = (description: string) => screen.getByLabelText(`Unidade de ${description}`);

  async function calculateSmall() {
    planning(() => ({ ok: true, data: WITH_SMALL }));
    recording();
    open();
    await calculate();
    await screen.findByText("Fermento");
  }

  it("starts each ingredient in the unit that reads best, with at most 3 places", async () => {
    await calculateSmall();

    expect(unitOf("Farinha de trigo")).toHaveValue("KILOGRAM");
    expect(unitOf("Fermento")).toHaveValue("GRAM");
    expect(rowOf("Fermento").getByText("12,346 g")).toBeInTheDocument();
    expect(rowOf("Fermento").getByText("10 g — sem validade")).toBeInTheDocument();
    expect(rowOf("Fermento").getByText("Faltam 2,346 g")).toBeInTheDocument();
  });

  it("shows the plan, the lots and what is missing in the unit chosen", async () => {
    await calculateSmall();

    await userEvent.selectOptions(unitOf("Fermento"), "kg");

    expect(rowOf("Fermento").getByText("0,012 kg")).toBeInTheDocument();
    expect(rowOf("Fermento").getByText("0,01 kg — sem validade")).toBeInTheDocument();
    expect(rowOf("Fermento").getByText("Faltam 0,002 kg")).toBeInTheDocument();
  });

  it("offers no unit to choose for an ingredient counted in units", async () => {
    await calculateSmall();

    expect(screen.queryByLabelText("Unidade de Ovo")).not.toBeInTheDocument();
  });

  it("records what was weighed in the product's own unit", async () => {
    await calculateSmall();

    await userEvent.type(screen.getByLabelText("Pesado de Farinha de trigo"), "6");
    await userEvent.type(screen.getByLabelText("Pesado de Fermento"), "12,346");
    await userEvent.type(screen.getByLabelText("Pesado de Ovo"), "4");
    await record();

    await waitFor(() =>
      expect(createPreWeighing).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            { productSku: FLOUR.sku, weighedQuantity: "6" },
            { productSku: YEAST.sku, weighedQuantity: "0.012346" },
            { productSku: EGG.sku, weighedQuantity: "4" },
          ],
        }),
      ),
    );
  });

  it("refuses a weighed quantity with more than 3 places in the unit shown", async () => {
    await calculateSmall();

    await userEvent.type(screen.getByLabelText("Pesado de Farinha de trigo"), "6,0505");
    await record();

    expect(
      await rowOf("Farinha de trigo").findByText("Informe o pesado, com até 3 casas decimais."),
    ).toBeInTheDocument();
    expect(createPreWeighing).not.toHaveBeenCalled();
  });

  it("carries what was already weighed into the unit chosen", async () => {
    await calculateSmall();

    await userEvent.type(screen.getByLabelText("Pesado de Fermento"), "250");
    await userEvent.selectOptions(unitOf("Fermento"), "kg");

    expect(screen.getByLabelText("Pesado de Fermento")).toHaveValue("0,25");
    expect(rowOf("Fermento").getByText("kg", { selector: "span" })).toBeInTheDocument();
  });
});

describe("PreWeighingPage, leftovers of what cannot be kept", () => {
  const MILK = { sku: "018f0000-0000-7000-8000-000000000024", description: "Leite condensado", unit: "GRAM" } as const;
  const CREAM = {
    sku: "018f0000-0000-7000-8000-000000000025",
    description: "Creme de leite",
    unit: "MILLILITER",
  } as const;

  const WITH_WASTE = aPreWeighingPlan({
    waste: {
      tolerance: 20,
      requested: { quantity: "10", loss: "3.20", leftovers: [{ product: MILK, leftover: "160", loss: "3.20" }] },
      alternatives: [
        { quantity: "10.533", loss: "0.00", leftovers: [{ product: MILK, leftover: "0.1", loss: "0.00" }] },
        { quantity: "11.85", loss: "0.00", leftovers: [] },
      ],
      unpackaged: [CREAM],
      uncosted: [MILK],
    },
  });

  const section = () => within(screen.getByRole("region", { name: "Sobras de abertos" }));

  it("asks the plan within the tolerance typed, 20% unless changed", async () => {
    planning();
    open();

    expect(screen.getByLabelText("Aceitar até (%)")).toHaveValue("20");
    await userEvent.clear(screen.getByLabelText("Aceitar até (%)"));
    await userEvent.type(screen.getByLabelText("Aceitar até (%)"), "35");
    await calculate();

    await waitFor(() => expect(planPreWeighing).toHaveBeenCalledWith({ productSku: BREAD.sku, quantity: "10" }, 35));
  });

  it.each(["101", ""])("refuses a tolerance of %j", async (typed) => {
    planning();
    open();

    await userEvent.clear(screen.getByLabelText("Aceitar até (%)"));
    if (typed !== "") await userEvent.type(screen.getByLabelText("Aceitar até (%)"), typed);
    await calculate();

    expect(await screen.findByText("Informe um número inteiro de 0 a 100.")).toBeInTheDocument();
    expect(planPreWeighing).not.toHaveBeenCalled();
  });

  it("tells what the quantity asked for leaves behind, and the quantities that leave less", async () => {
    planning(() => ({ ok: true, data: WITH_WASTE }));
    open();
    await calculate();

    await screen.findByRole("region", { name: "Sobras de abertos" });
    expect(section().getByText("10 kg: perda de R$ 3,20 (160 g de Leite condensado)")).toBeInTheDocument();
    expect(section().getByText("10,533 kg: perda de R$ 0,00 (0,1 g de Leite condensado)")).toBeInTheDocument();
    expect(section().getByText("11,85 kg: sem sobras")).toBeInTheDocument();
    expect(section().getByText("Creme de leite: sem embalagem conhecida.")).toBeInTheDocument();
    expect(section().getByText("Leite condensado: sem custo médio.")).toBeInTheDocument();
  });

  it("produces a suggested quantity on request, within the same tolerance", async () => {
    planning(() => ({ ok: true, data: WITH_WASTE }));
    open();
    await calculate();

    await userEvent.click(await section().findByRole("button", { name: "Produzir 10,533 kg" }));

    expect(screen.getByLabelText("Quantidade a produzir")).toHaveValue("10,533");
    await waitFor(() =>
      expect(planPreWeighing).toHaveBeenLastCalledWith({ productSku: BREAD.sku, quantity: "10.533" }, 20),
    );
  });

  it("produces a suggestion with the plan's own product and tolerance, and shows them", async () => {
    planning(() => ({ ok: true, data: WITH_WASTE }));
    open();
    await calculate();
    await screen.findByRole("region", { name: "Sobras de abertos" });

    await userEvent.clear(screen.getByLabelText("Aceitar até (%)"));
    await userEvent.type(screen.getByLabelText("Aceitar até (%)"), "35");
    await userEvent.click(section().getByRole("button", { name: "Produzir 10,533 kg" }));

    expect(screen.getByLabelText("Aceitar até (%)")).toHaveValue("20");
    expect(screen.getByLabelText("Produto")).toHaveValue(BREAD.sku);
    await waitFor(() =>
      expect(planPreWeighing).toHaveBeenLastCalledWith({ productSku: BREAD.sku, quantity: "10.533" }, 20),
    );
  });

  it("offers no suggestion to produce while a plan is being worked out", async () => {
    planning(() => ({ ok: true, data: WITH_WASTE }));
    open();
    await calculate();
    await screen.findByRole("region", { name: "Sobras de abertos" });

    let answer: (result: Awaited<ReturnType<typeof planPreWeighing>>) => void = () => undefined;
    vi.mocked(planPreWeighing).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));

    await waitFor(() => expect(section().getByRole("button", { name: "Produzir 10,533 kg" })).toBeDisabled());

    // React keeps every later transition pending while one never settles, which would leak into the tests after this.
    answer({ ok: true, data: WITH_WASTE });
    await waitFor(() => expect(section().getByRole("button", { name: "Produzir 10,533 kg" })).toBeEnabled());
  });

  it("takes the tolerance in whole percent, a comma left out", async () => {
    open();

    await userEvent.clear(screen.getByLabelText("Aceitar até (%)"));
    await userEvent.type(screen.getByLabelText("Aceitar até (%)"), "2,5");

    expect(screen.getByLabelText("Aceitar até (%)")).toHaveValue("25");
  });

  it("says when no quantity within the tolerance leaves less", async () => {
    planning(() => ({
      ok: true,
      data: aPreWeighingPlan({
        waste: {
          tolerance: 20,
          requested: { quantity: "10", loss: "0.00", leftovers: [] },
          alternatives: [],
          unpackaged: [],
          uncosted: [],
        },
      }),
    }));
    open();
    await calculate();

    await screen.findByRole("region", { name: "Sobras de abertos" });
    expect(section().getByText("10 kg: sem sobras")).toBeInTheDocument();
    expect(section().getByText("Nenhuma quantidade até +20% reduz as sobras.")).toBeInTheDocument();
  });

  it("does not claim nothing leaves less when an ingredient without cost was left out of the comparison", async () => {
    planning(() => ({
      ok: true,
      data: aPreWeighingPlan({
        waste: {
          tolerance: 20,
          requested: { quantity: "10", loss: "0.00", leftovers: [{ product: MILK, leftover: "160", loss: null }] },
          alternatives: [],
          unpackaged: [],
          uncosted: [MILK],
        },
      }),
    }));
    open();
    await calculate();

    await screen.findByRole("region", { name: "Sobras de abertos" });
    expect(section().queryByText(/reduz as sobras/)).not.toBeInTheDocument();
    expect(
      section().getByText(
        "Nenhuma quantidade até +20% reduz a perda calculada; o que não tem custo médio ficou fora da comparação.",
      ),
    ).toBeInTheDocument();
  });

  it("shows no leftovers when the recipe takes nothing that cannot be kept", async () => {
    planning();
    open();
    await calculate();

    await screen.findByRole("heading", { name: "Plano para 10 kg de Pão francês" });
    expect(screen.queryByRole("region", { name: "Sobras de abertos" })).not.toBeInTheDocument();
  });
});

describe("PreWeighingPage, intermediates made in the same session", () => {
  const BOMBOM = aProduct({
    sku: "018f0000-0000-7000-8000-000000000091",
    description: "Bombom",
    kind: "MANUFACTURED",
  });
  const FILLING = {
    sku: "018f0000-0000-7000-8000-000000000092",
    description: "Recheio",
    unit: "KILOGRAM",
  } as const;
  const MILK = { sku: "018f0000-0000-7000-8000-000000000024", description: "Leite condensado", unit: "GRAM" } as const;
  const CHOCOLATE = { sku: "018f0000-0000-7000-8000-000000000026", description: "Chocolate", unit: "GRAM" } as const;
  const SUGAR = { sku: "018f0000-0000-7000-8000-000000000027", description: "Açúcar", unit: "GRAM" } as const;

  const fillingStage = (quantity: string, milk: string, chocolate: string) =>
    aPreWeighingPlan({
      product: FILLING,
      quantity,
      items: [
        { product: MILK, plannedQuantity: milk, lots: [], shortfall: "0", manufactured: null },
        { product: CHOCOLATE, plannedQuantity: chocolate, lots: [], shortfall: "0", manufactured: null },
      ],
    });

  const withFilling = (toProduce: string, stage = fillingStage(toProduce, "600", "400")) =>
    aPreWeighingPlan({
      product: { sku: BOMBOM.sku, description: BOMBOM.description, unit: BOMBOM.unit },
      quantity: "2",
      items: [
        {
          product: FILLING,
          plannedQuantity: "1",
          lots: [],
          shortfall: "1",
          manufactured: { needed: "1", inStock: "0.25", toProduce, stage },
        },
        { product: SUGAR, plannedQuantity: "200", lots: [], shortfall: "0", manufactured: null },
      ],
    });

  const WITH_FILLING = withFilling("1");

  async function calculateBombom() {
    planning(() => ({ ok: true, data: WITH_FILLING }));
    recording();
    open([BOMBOM]);
    await userEvent.selectOptions(await screen.findByLabelText("Produto"), "Bombom (kg)");
    await userEvent.type(screen.getByLabelText("Quantidade a produzir"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    await screen.findByLabelText("A fabricar de Recheio");
  }

  it("shows needed, in stock and to produce on an intermediate", async () => {
    await calculateBombom();

    expect(screen.getByRole("columnheader", { name: "Necessário" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "No estoque" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "A fabricar" })).toBeInTheDocument();

    const filling = within(screen.getByLabelText("A fabricar de Recheio").closest("tr")!);
    expect(filling.getByText("Recheio")).toBeInTheDocument();
    expect(filling.getByText("1 kg")).toBeInTheDocument();
    expect(filling.getByText("0,25 kg")).toBeInTheDocument();
    expect(screen.getByLabelText("A fabricar de Recheio")).toHaveValue("1");
    expect(screen.queryByLabelText("Pesado de Recheio")).not.toBeInTheDocument();
  });

  it("re-plans when the quantity to produce changes", async () => {
    await calculateBombom();

    await userEvent.clear(screen.getByLabelText("A fabricar de Recheio"));
    await userEvent.type(screen.getByLabelText("A fabricar de Recheio"), "0,5");

    await waitFor(
      () =>
        expect(planPreWeighing).toHaveBeenLastCalledWith({ productSku: BOMBOM.sku, quantity: "2" }, 20, {
          [FILLING.sku]: "0.5",
        }),
      { timeout: 2000 },
    );
    expect(planPreWeighing).toHaveBeenCalledTimes(2);
  });

  it("weighs the ingredients of every stage", async () => {
    await calculateBombom();

    expect(screen.getByRole("heading", { name: "Fabricar 1 kg de Recheio" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pesado de Leite condensado")).toHaveValue("");
    expect(screen.getByLabelText("Pesado de Chocolate")).toHaveValue("");
    expect(screen.getByLabelText("Pesado de Açúcar")).toHaveValue("");
  });

  it("shows no stage for an intermediate taken from stock", async () => {
    planning(() => ({ ok: true, data: withFilling("0", null as never) }));
    open([BOMBOM]);
    await userEvent.selectOptions(await screen.findByLabelText("Produto"), "Bombom (kg)");
    await userEvent.type(screen.getByLabelText("Quantidade a produzir"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));

    expect(await screen.findByLabelText("A fabricar de Recheio")).toHaveValue("0");
    expect(screen.queryByRole("heading", { name: /^Fabricar/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Pesado de Leite condensado")).not.toBeInTheDocument();
  });

  it("sends the tree", async () => {
    await calculateBombom();

    await userEvent.type(screen.getByLabelText("Pesado de Leite condensado"), "600");
    await userEvent.type(screen.getByLabelText("Pesado de Chocolate"), "400");
    await userEvent.type(screen.getByLabelText("Pesado de Açúcar"), "200");
    await record();

    await waitFor(() =>
      expect(createPreWeighing).toHaveBeenCalledWith(createBodyOf(WITH_FILLING, ["600", "400", "200"])),
    );
  });

  it("keeps what was weighed of the lines the new plan still has", async () => {
    await calculateBombom();
    planning(() => ({ ok: true, data: withFilling("0.5", fillingStage("0.5", "300", "200")) }));

    await userEvent.type(screen.getByLabelText("Pesado de Leite condensado"), "600");
    await userEvent.type(screen.getByLabelText("Pesado de Açúcar"), "200");
    await userEvent.clear(screen.getByLabelText("A fabricar de Recheio"));
    await userEvent.type(screen.getByLabelText("A fabricar de Recheio"), "0,5");

    expect(await screen.findByRole("heading", { name: "Fabricar 0,5 kg de Recheio" }, { timeout: 2000 })).toBeVisible();
    expect(screen.getByLabelText("Pesado de Leite condensado")).toHaveValue("600");
    expect(screen.getByLabelText("Pesado de Açúcar")).toHaveValue("200");
    expect(screen.getByLabelText("A fabricar de Recheio")).toHaveValue("0,5");
  });

  it("tells the leftovers of a stage, and makes a quantity it suggests", async () => {
    const waste = (quantity: string) => ({
      tolerance: 20,
      requested: { quantity, loss: "0.00", leftovers: [] },
      alternatives: [{ quantity: "1.2", loss: "0.00", leftovers: [] }],
      unpackaged: [],
      uncosted: [],
    });
    const stage = { ...fillingStage("1", "600", "400"), waste: waste("1") };
    planning(() => ({ ok: true, data: { ...withFilling("1", stage), waste: waste("2") } }));
    open([BOMBOM]);
    await userEvent.selectOptions(await screen.findByLabelText("Produto"), "Bombom (kg)");
    await userEvent.type(screen.getByLabelText("Quantidade a produzir"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));

    const sections = await screen.findAllByRole("region", { name: "Sobras de abertos" });
    expect(sections).toHaveLength(2);
    expect(new Set(sections.map((section) => section.getAttribute("aria-labelledby"))).size).toBe(2);

    await userEvent.click(within(sections[1]!).getByRole("button", { name: "Produzir 1,2 kg" }));

    await waitFor(
      () =>
        expect(planPreWeighing).toHaveBeenLastCalledWith({ productSku: BOMBOM.sku, quantity: "2" }, 20, {
          [FILLING.sku]: "1.2",
        }),
      { timeout: 2000 },
    );
    expect(screen.getByLabelText("A fabricar de Recheio")).toHaveValue("1,2");
  });

  it("follows the latest quantity to produce when the plans come back out of order", async () => {
    await calculateBombom();
    const answers: Array<(result: Awaited<ReturnType<typeof planPreWeighing>>) => void> = [];
    vi.mocked(planPreWeighing).mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const field = () => screen.getByLabelText("A fabricar de Recheio");

    await userEvent.clear(field());
    await userEvent.type(field(), "0,5");
    await waitFor(() => expect(answers).toHaveLength(1), { timeout: 2000 });
    await userEvent.clear(field());
    await userEvent.type(field(), "0,7");
    await waitFor(() => expect(answers).toHaveLength(2), { timeout: 2000 });

    const latest = withFilling("0.7", fillingStage("0.7", "420", "280"));
    answers[1]!({ ok: true, data: latest });
    answers[0]!({ ok: true, data: withFilling("0.5", fillingStage("0.5", "300", "200")) });

    expect(await screen.findByRole("heading", { name: "Fabricar 0,7 kg de Recheio" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Calculando…")).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Fabricar 0,5 kg de Recheio" })).not.toBeInTheDocument();

    recording();
    await userEvent.type(screen.getByLabelText("Pesado de Leite condensado"), "420");
    await userEvent.type(screen.getByLabelText("Pesado de Chocolate"), "280");
    await userEvent.type(screen.getByLabelText("Pesado de Açúcar"), "200");
    await record();

    await waitFor(() => expect(createPreWeighing).toHaveBeenCalledWith(createBodyOf(latest, ["420", "280", "200"])));
  });

  it("does not record while a quantity to produce waits to be planned", async () => {
    await calculateBombom();

    await userEvent.clear(screen.getByLabelText("A fabricar de Recheio"));
    await userEvent.type(screen.getByLabelText("A fabricar de Recheio"), "0,5");

    expect(screen.getByRole("button", { name: "Registrar pré-pesagem" })).toBeDisabled();
    await waitFor(() => expect(planPreWeighing).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrar pré-pesagem" })).toBeEnabled());
  });

  it("keeps the plan and what was weighed when a re-plan fails", async () => {
    await calculateBombom();
    await userEvent.type(screen.getByLabelText("Pesado de Leite condensado"), "600");
    planning(() => ({ ok: false, status: 409, message: "Quantity is out of range for this recipe." }));

    await userEvent.clear(screen.getByLabelText("A fabricar de Recheio"));
    await userEvent.type(screen.getByLabelText("A fabricar de Recheio"), "0,5");

    expect(await screen.findByRole("alert", {}, { timeout: 2000 })).toHaveTextContent(/^Não foi possível calcular/);
    expect(screen.getByRole("heading", { name: "Fabricar 1 kg de Recheio" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pesado de Leite condensado")).toHaveValue("600");
    expect(screen.getByLabelText("A fabricar de Recheio")).toHaveValue("0,5");
    expect(screen.getByRole("button", { name: "Registrar pré-pesagem" })).toBeDisabled();
  });

  it("records again once the quantity to produce is planned after a failed re-plan", async () => {
    await calculateBombom();
    planning(() => ({ ok: false, status: 409, message: "Quantity is out of range for this recipe." }));
    await userEvent.clear(screen.getByLabelText("A fabricar de Recheio"));
    await userEvent.type(screen.getByLabelText("A fabricar de Recheio"), "0,5");
    await screen.findByRole("alert", {}, { timeout: 2000 });
    planning(() => ({ ok: true, data: withFilling("0.6") }));

    await userEvent.clear(screen.getByLabelText("A fabricar de Recheio"));
    await userEvent.type(screen.getByLabelText("A fabricar de Recheio"), "0,6");

    await waitFor(() => expect(screen.getByRole("button", { name: "Registrar pré-pesagem" })).toBeEnabled(), {
      timeout: 2000,
    });
  });

  it("does not record while a quantity to produce is not one the unit allows", async () => {
    await calculateBombom();

    await userEvent.clear(screen.getByLabelText("A fabricar de Recheio"));
    await userEvent.type(screen.getByLabelText("A fabricar de Recheio"), "0,1234");

    expect(await screen.findByText(/casas decimais|casa decimal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar pré-pesagem" })).toBeDisabled();
  });

  it("clears the plan when Calcular fails", async () => {
    await calculateBombom();
    planning(() => ({ ok: false, status: 409, message: "Product has no recipe." }));

    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/^Não foi possível calcular/);
    expect(screen.queryByRole("button", { name: "Registrar pré-pesagem" })).not.toBeInTheDocument();
  });

  it("leaves the complement once it is recorded, so it cannot be recorded twice", async () => {
    const PARENT_ID = "018f0000-0000-7000-8000-0000000000a5";
    const FILLING_PRODUCT = aProduct({ ...FILLING, kind: "MANUFACTURED" });
    const FILLING_PLAN = fillingStage("0.5", "300", "200");
    planning(() => ({ ok: true, data: FILLING_PLAN }));
    recording(() => ({ ok: true, data: aPreWeighing({ product: FILLING, quantity: "0.5" }) }));
    navigation.reset(`/pre-weighings/new?parentId=${PARENT_ID}&productSku=${FILLING.sku}&quantity=0.5`);
    renderWithProviders(
      <PreWeighingPage
        products={[BOMBOM, FILLING_PRODUCT]}
        complement={{ parentId: PARENT_ID, parentDescription: "Bombom", productSku: FILLING.sku, quantity: "0.5" }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    await userEvent.type(await screen.findByLabelText("Pesado de Leite condensado"), "300");
    await userEvent.type(screen.getByLabelText("Pesado de Chocolate"), "200");
    await record();

    expect(await screen.findByRole("status")).toHaveTextContent("Pré-pesagem registrada: 0,5 kg de Recheio.");
    expect(navigation.url).toBe("/pre-weighings/new");
    expect(screen.queryByRole("button", { name: "Registrar pré-pesagem" })).not.toBeInTheDocument();
    // What is left on screen is a new pre-weighing: no parent, and a target of the operator's own.
    expect(screen.queryByText("Complemento da pré-pesagem de Bombom")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Produto")).toBeEnabled();
    expect(screen.getByLabelText("Produto")).toHaveValue("");
    expect(createPreWeighing).toHaveBeenCalledTimes(1);
  });

  it("records a complement", async () => {
    const PARENT_ID = "018f0000-0000-7000-8000-0000000000a5";
    const FILLING_PRODUCT = aProduct({ ...FILLING, kind: "MANUFACTURED" });
    const FILLING_PLAN = fillingStage("0.5", "300", "200");
    planning(() => ({ ok: true, data: FILLING_PLAN }));
    recording();
    renderWithProviders(
      <PreWeighingPage
        products={[BOMBOM, FILLING_PRODUCT]}
        complement={{ parentId: PARENT_ID, parentDescription: "Bombom", productSku: FILLING.sku, quantity: "0.5" }}
      />,
    );

    expect(screen.getByText("Complemento da pré-pesagem de Bombom")).toBeInTheDocument();
    expect(screen.getByLabelText("Produto")).toHaveValue(FILLING.sku);
    expect(screen.getByLabelText("Produto")).toBeDisabled();
    expect(screen.getByLabelText("Quantidade a produzir")).toHaveValue("0,5");
    expect(screen.getByLabelText("Quantidade a produzir")).toHaveAttribute("readonly");

    await userEvent.click(screen.getByRole("button", { name: "Calcular" }));
    await waitFor(() => expect(planPreWeighing).toHaveBeenCalledWith({ productSku: FILLING.sku, quantity: "0.5" }, 20));
    await userEvent.type(await screen.findByLabelText("Pesado de Leite condensado"), "300");
    await userEvent.type(screen.getByLabelText("Pesado de Chocolate"), "200");
    await record();

    await waitFor(() =>
      expect(createPreWeighing).toHaveBeenCalledWith(createBodyOf(FILLING_PLAN, ["300", "200"], PARENT_ID)),
    );
  });
});
