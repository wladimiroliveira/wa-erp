import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRecipe, saveRecipe, type RecipeResult } from "@/features/recipes/actions";
import { RecipeSheet, type RecipeSheetTarget } from "@/features/recipes/RecipeSheet";
import type { Recipe } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aProduct, aRecipe } from "@/tests/samples";

vi.mock("@/features/recipes/actions", () => ({ readRecipe: vi.fn(), saveRecipe: vi.fn() }));

const readMock = vi.mocked(readRecipe);
const saveMock = vi.mocked(saveRecipe);

const BREAD = aProduct({
  sku: "018f0000-0000-7000-8000-000000000090",
  description: "Pão francês",
  kind: "MANUFACTURED",
});
const FLOUR = aProduct();
const SALT = aProduct({ sku: "018f0000-0000-7000-8000-000000000021", description: "Sal", unit: "GRAM" });
const CATALOG = [BREAD, FLOUR, SALT];

const summaryOf = ({ sku, description, unit }: typeof FLOUR) => ({ sku, description, unit });

/** A product with no recipe yet is an answer, not a failure. */
const NO_RECIPE = (): Awaited<ReturnType<typeof readRecipe>> => ({ ok: true, data: null });
const RECIPE = (recipe: Recipe): Awaited<ReturnType<typeof readRecipe>> => ({ ok: true, data: recipe });

const TWO_INGREDIENTS = aRecipe({
  yieldQuantity: "10.5",
  ingredients: [
    { product: summaryOf(FLOUR), quantity: "6.25" },
    { product: summaryOf(SALT), quantity: "120" },
  ],
});

/** Answers every read of the recipe of the bread with `respond`. */
function withRecipe(respond: () => Awaited<ReturnType<typeof readRecipe>> = NO_RECIPE) {
  readMock.mockImplementation(async () => respond());
}

/** Captures what the sheet sends and answers every attempt with `respond`. */
function saving(respond: () => RecipeResult = () => ({ ok: true, data: aRecipe() })) {
  const received: unknown[] = [];

  saveMock.mockImplementation(async (_sku, body) => {
    received.push(body);
    return respond();
  });

  return received;
}

beforeEach(() => {
  readMock.mockReset();
  saveMock.mockReset();
});

function open(mode: RecipeSheetTarget["mode"], { catalog = CATALOG, onClose = vi.fn() } = {}) {
  renderWithProviders(<RecipeSheet target={{ product: BREAD, mode }} catalog={catalog} onClose={onClose} />);

  return onClose;
}

/** Opens the bread straight into its form, as the edit action of the list does. */
async function editBread(options?: Parameters<typeof open>[1]) {
  const onClose = open("edit", options);
  await screen.findByRole("button", { name: "Salvar receita" });

  return onClose;
}

async function fillIngredient(position: number, product: string, quantity: string) {
  await userEvent.selectOptions(screen.getByLabelText(`Ingrediente ${position}`), product);
  await userEvent.type(screen.getByLabelText(`Quantidade do ingrediente ${position}`), quantity);
}

const addIngredient = () => userEvent.click(screen.getByRole("button", { name: "Adicionar ingrediente" }));
const save = () => userEvent.click(screen.getByRole("button", { name: "Salvar receita" }));
const cancel = () => userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

describe("RecipeSheet, reading", () => {
  it("shows the recipe as text, with no field to type into", async () => {
    withRecipe(() => RECIPE(TWO_INGREDIENTS));

    open("view");

    expect(await screen.findByRole("heading", { name: "Receita de Pão francês" })).toBeInTheDocument();
    expect(screen.getByText("10,5 kg")).toBeInTheDocument();
    const flour = within(screen.getByRole("row", { name: /Farinha de trigo/ }));
    expect(flour.getByText("6,25 kg")).toBeInTheDocument();
    const salt = within(screen.getByRole("row", { name: /Sal/ }));
    expect(salt.getByText("120 g")).toBeInTheDocument();
    expect(screen.getByText(/^Atualizada em 13\/10\/2026/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says when the product has no recipe yet, and offers to create one", async () => {
    withRecipe();

    open("view");

    expect(await screen.findByText("Pão francês ainda não tem receita.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Criar receita" }));

    expect(await screen.findByRole("heading", { name: "Nova receita de Pão francês" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rendimento (kg)")).toHaveValue("");
  });

  it("turns into the form only when Editar receita is pressed", async () => {
    withRecipe(() => RECIPE(TWO_INGREDIENTS));

    open("view");
    await userEvent.click(await screen.findByRole("button", { name: "Editar receita" }));

    expect(screen.getByLabelText("Rendimento (kg)")).toHaveValue("10,5");
    expect(screen.getByLabelText("Ingrediente 1")).toHaveValue(FLOUR.sku);
  });

  it("offers a way out when the recipe fails to load", async () => {
    let attempts = 0;
    withRecipe(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("fetch failed");
      return NO_RECIPE();
    });

    open("view");
    await userEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText("Pão francês ainda não tem receita.")).toBeInTheDocument();
  });
});

describe("RecipeSheet, editing", () => {
  it("starts a blank recipe for a product that has none", async () => {
    withRecipe();

    await editBread();

    expect(screen.getByRole("heading", { name: "Nova receita de Pão francês" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rendimento (kg)")).toHaveValue("");
    expect(screen.getByLabelText("Ingrediente 1")).toHaveValue("");
    expect(screen.getByLabelText("Quantidade do ingrediente 1")).toHaveValue("");
    expect(screen.queryByLabelText("Ingrediente 2")).not.toBeInTheDocument();
  });

  it("offers every active product as an ingredient, except the one the recipe makes", async () => {
    withRecipe();

    await editBread({ catalog: [...CATALOG, aProduct({ sku: "sku-4", description: "Fermento", isActive: false })] });

    const ingredient = screen.getByLabelText("Ingrediente 1");
    expect(ingredient).toHaveTextContent("Farinha de trigo (kg)");
    expect(ingredient).toHaveTextContent("Sal (g)");
    expect(ingredient).not.toHaveTextContent("Pão francês");
    expect(ingredient).not.toHaveTextContent("Fermento");
  });

  it("opens the recipe a product already has, written the Portuguese way", async () => {
    withRecipe(() => RECIPE(TWO_INGREDIENTS));

    await editBread();

    expect(screen.getByRole("heading", { name: "Receita de Pão francês" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rendimento (kg)")).toHaveValue("10,5");
    expect(screen.getByLabelText("Ingrediente 1")).toHaveValue(FLOUR.sku);
    expect(screen.getByLabelText("Quantidade do ingrediente 1")).toHaveValue("6,25");
    expect(screen.getByLabelText("Ingrediente 2")).toHaveValue(SALT.sku);
    expect(screen.getByLabelText("Quantidade do ingrediente 2")).toHaveValue("120");
  });

  // The API refuses a recipe with an inactive ingredient, but the one already in it has to stay
  // on the screen for the operator to see what to take out.
  it("keeps an ingredient that went inactive in the recipe it is already in, marked as such", async () => {
    const yeast = aProduct({ sku: "018f0000-0000-7000-8000-000000000022", description: "Fermento", isActive: false });
    withRecipe(() => RECIPE(aRecipe({ ingredients: [{ product: summaryOf(yeast), quantity: "1" }] })));

    await editBread({ catalog: [BREAD, FLOUR, yeast] });

    expect(screen.getByLabelText("Ingrediente 1")).toHaveValue(yeast.sku);
    expect(screen.getByRole("option", { name: "Fermento (kg) — inativo" })).toBeInTheDocument();
  });

  it("shows the unit of the ingredient chosen beside its quantity", async () => {
    withRecipe();

    await editBread();
    await userEvent.selectOptions(screen.getByLabelText("Ingrediente 1"), "Sal (g)");

    expect(screen.getByTestId("ingredient-unit-1")).toHaveTextContent("g");
  });

  it("refuses to save without a yield, an ingredient and its quantity", async () => {
    withRecipe();
    const received = saving();

    await editBread();
    await save();

    expect(await screen.findByText("Informe o rendimento, com até 6 casas decimais.")).toBeInTheDocument();
    expect(screen.getByText("Escolha o ingrediente.")).toBeInTheDocument();
    expect(screen.getByText("Informe a quantidade, com até 6 casas decimais.")).toBeInTheDocument();
    expect(received).toEqual([]);
  });

  it("refuses a zero yield and a zero quantity", async () => {
    withRecipe();
    const received = saving();

    await editBread();
    await userEvent.type(screen.getByLabelText("Rendimento (kg)"), "0");
    await fillIngredient(1, "Sal (g)", "0");
    await save();

    expect(await screen.findByText("O rendimento deve ser maior que zero.")).toBeInTheDocument();
    expect(screen.getByText("A quantidade deve ser maior que zero.")).toBeInTheDocument();
    expect(received).toEqual([]);
  });

  it("refuses the same ingredient twice", async () => {
    withRecipe();
    const received = saving();

    await editBread();
    await userEvent.type(screen.getByLabelText("Rendimento (kg)"), "10");
    await fillIngredient(1, "Sal (g)", "100");
    await addIngredient();
    await fillIngredient(2, "Sal (g)", "20");
    await save();

    expect(await screen.findByText("Cada ingrediente só pode aparecer uma vez.")).toBeInTheDocument();
    expect(received).toEqual([]);
  });

  it("saves the yield and each ingredient, with decimal points", async () => {
    withRecipe();
    const received = saving();

    await editBread();
    await userEvent.type(screen.getByLabelText("Rendimento (kg)"), "10,5");
    await fillIngredient(1, "Farinha de trigo (kg)", "6,25");
    await addIngredient();
    await fillIngredient(2, "Sal (g)", "120");
    await save();

    await waitFor(() =>
      expect(received).toEqual([
        {
          yieldQuantity: "10.5",
          ingredients: [
            { productSku: FLOUR.sku, quantity: "6.25" },
            { productSku: SALT.sku, quantity: "120" },
          ],
        },
      ]),
    );
  });

  it("leaves out an ingredient that was removed", async () => {
    withRecipe(() =>
      RECIPE(
        aRecipe({
          ingredients: [
            { product: summaryOf(FLOUR), quantity: "6" },
            { product: summaryOf(SALT), quantity: "120" },
          ],
        }),
      ),
    );
    const received = saving();

    await editBread();
    await userEvent.click(screen.getByRole("button", { name: "Remover ingrediente 1" }));
    await save();

    await waitFor(() =>
      expect(received).toEqual([{ yieldQuantity: "10", ingredients: [{ productSku: SALT.sku, quantity: "120" }] }]),
    );
  });

  it("does not let the only ingredient be removed", async () => {
    withRecipe();

    await editBread();

    expect(screen.getByRole("button", { name: "Remover ingrediente 1" })).toBeDisabled();
  });

  it("goes back to reading the recipe it saved", async () => {
    withRecipe();
    saving(() => ({
      ok: true,
      data: aRecipe({ yieldQuantity: "10.5", ingredients: [{ product: summaryOf(SALT), quantity: "120" }] }),
    }));

    await editBread();
    await userEvent.type(screen.getByLabelText("Rendimento (kg)"), "10,5");
    await fillIngredient(1, "Sal (g)", "120");
    await save();

    expect(await screen.findByRole("heading", { name: "Receita de Pão francês" })).toBeInTheDocument();
    expect(screen.getByText("10,5 kg")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Sal/ })).getByText("120 g")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each([
    [404, "O produto ou um ingrediente não existe mais. Atualize a página."],
    [
      409,
      "Não foi possível salvar: o produto ou um ingrediente está inativo, ou um ingrediente leva este produto na própria receita.",
    ],
  ])("explains a %i from the server and keeps what was typed", async (status, message) => {
    withRecipe();
    saving(() => ({ ok: false, status: status as 404 | 409, message: "Refused." }));

    await editBread();
    await userEvent.type(screen.getByLabelText("Rendimento (kg)"), "10");
    await fillIngredient(1, "Sal (g)", "120");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Rendimento (kg)")).toHaveValue("10");
  });
});

describe("RecipeSheet, leaving the form", () => {
  it("goes back to reading at once when nothing was changed", async () => {
    withRecipe(() => RECIPE(TWO_INGREDIENTS));

    await editBread();
    await cancel();

    expect(await screen.findByRole("button", { name: "Editar receita" })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks before throwing away what was changed, and keeps it when the operator stays", async () => {
    withRecipe(() => RECIPE(TWO_INGREDIENTS));

    await editBread();
    await userEvent.clear(screen.getByLabelText("Rendimento (kg)"));
    await userEvent.type(screen.getByLabelText("Rendimento (kg)"), "12");
    await cancel();

    const ask = await screen.findByRole("alertdialog", { name: "Descartar as alterações?" });
    await userEvent.click(within(ask).getByRole("button", { name: "Continuar editando" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Rendimento (kg)")).toHaveValue("12");
  });

  it("goes back to the saved recipe once the changes are discarded", async () => {
    withRecipe(() => RECIPE(TWO_INGREDIENTS));

    await editBread();
    await userEvent.clear(screen.getByLabelText("Rendimento (kg)"));
    await userEvent.type(screen.getByLabelText("Rendimento (kg)"), "12");
    await cancel();
    await userEvent.click(await screen.findByRole("button", { name: "Descartar" }));

    expect(await screen.findByText("10,5 kg")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("asks before closing the sheet over changes, and closes once they are discarded", async () => {
    withRecipe(() => RECIPE(TWO_INGREDIENTS));

    const onClose = await editBread();
    await userEvent.type(screen.getByLabelText("Quantidade do ingrediente 1"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(await screen.findByRole("alertdialog", { name: "Descartar as alterações?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes at once when reading", async () => {
    withRecipe(() => RECIPE(TWO_INGREDIENTS));

    const onClose = open("view");
    await screen.findByRole("button", { name: "Editar receita" });
    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
