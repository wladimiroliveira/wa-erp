import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPreWeighing, planPreWeighing } from "@/features/pre-weighings/actions";
import { PreWeighingPage } from "@/features/pre-weighings/PreWeighingPage";
import type { Product } from "@/lib/api";
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
    },
    {
      product: SALT,
      plannedQuantity: "120",
      lots: [{ id: "lot-3", expiresAt: null, quantity: "100" }],
      shortfall: "20",
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

    await waitFor(() => expect(planPreWeighing).toHaveBeenCalledWith({ productSku: BREAD.sku, quantity: "10.5" }));
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
      data: aPreWeighingPlan({ items: [{ product: SALT, plannedQuantity: "120", lots: [], shortfall: "120" }] }),
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
      { product: FLOUR, plannedQuantity: "6", lots: [{ id: "lot-1", expiresAt: null, quantity: "6" }], shortfall: "0" },
      {
        product: YEAST,
        plannedQuantity: "0.0123456",
        lots: [{ id: "lot-2", expiresAt: null, quantity: "0.01" }],
        shortfall: "0.0023456",
      },
      { product: EGG, plannedQuantity: "4", lots: [], shortfall: "4" },
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
