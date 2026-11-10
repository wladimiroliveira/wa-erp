import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProduct, updateProduct } from "@/features/products/actions";
import { ProductDialog } from "@/features/products/ProductDialog";
import { renderWithProviders } from "@/tests/render";
import { PRODUCT_CONFLICTS, PRODUCT_REFUSALS } from "@/server/modules/products/products.schemas";
import { aPackaging, aProduct } from "@/tests/samples";

vi.mock("@/features/products/actions", () => ({ createProduct: vi.fn(), updateProduct: vi.fn() }));

const createMock = vi.mocked(createProduct);
const updateMock = vi.mocked(updateProduct);

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ ok: true, data: aProduct() });
  updateMock.mockReset();
});

async function fill({
  description = "Farinha de trigo",
  packaging = null as null | { content: string; unit?: string; gtin?: string },
} = {}) {
  await userEvent.type(screen.getByLabelText("Descrição"), description);
  await userEvent.selectOptions(screen.getByLabelText("Tipo"), "Mercadoria");
  await userEvent.selectOptions(screen.getByLabelText("Unidade"), "Quilograma (kg)");
  if (packaging !== null) {
    await userEvent.click(screen.getByRole("button", { name: "Adicionar embalagem" }));
    await userEvent.type(screen.getByLabelText("Conteúdo da embalagem 1"), packaging.content);
    if (packaging.unit) await userEvent.selectOptions(screen.getByLabelText("Unidade da embalagem 1"), packaging.unit);
    if (packaging.gtin) await userEvent.type(screen.getByLabelText("GTIN da embalagem 1"), packaging.gtin);
  }
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
}

describe("ProductDialog", () => {
  it("refuses a product with no description, kind or unit", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Informe a descrição do produto.")).toBeInTheDocument();
    expect(screen.getByText("Escolha o tipo.")).toBeInTheDocument();
    expect(screen.getByText("Escolha a unidade.")).toBeInTheDocument();
  });

  it("refuses a GTIN that is not 8 to 14 digits", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    await fill({ packaging: { content: "1", gtin: "789-1000" } });

    expect(await screen.findByText("O GTIN tem de 8 a 14 dígitos, só números.")).toBeInTheDocument();
  });

  it("refuses a GTIN whose check digit does not match", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    await fill({ packaging: { content: "1", gtin: "7891000100104" } });

    expect(await screen.findByText("O dígito verificador do GTIN não confere. Revise o código.")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("writes the description in upper case as it is typed", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    await userEvent.type(screen.getByLabelText("Descrição"), "açúcar");

    expect(screen.getByLabelText("Descrição")).toHaveValue("AÇÚCAR");
  });

  it("offers packagings only once the unit is chosen, in the units that measure it", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    expect(screen.getByRole("button", { name: "Adicionar embalagem" })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Unidade"), "Quilograma (kg)");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar embalagem" }));

    const options = within(screen.getByLabelText("Unidade da embalagem 1")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["kg", "g"]);
  });

  it("moves a packaging to the new unit when the product's unit changes to another dimension", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText("Unidade"), "Quilograma (kg)");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar embalagem" }));

    await userEvent.selectOptions(screen.getByLabelText("Unidade"), "Litro (L)");

    expect(screen.getByLabelText("Unidade da embalagem 1")).toHaveDisplayValue("L");
  });

  it("removes a packaging row that was never saved", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText("Unidade"), "Quilograma (kg)");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar embalagem" }));

    await userEvent.click(screen.getByRole("button", { name: "Remover embalagem 1" }));

    expect(screen.queryByLabelText("Conteúdo da embalagem 1")).not.toBeInTheDocument();
  });

  it("refuses the same GTIN on two packagings", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText("Unidade"), "Quilograma (kg)");
    for (const position of [1, 2]) {
      await userEvent.click(screen.getByRole("button", { name: "Adicionar embalagem" }));
      await userEvent.type(screen.getByLabelText(`Conteúdo da embalagem ${position}`), String(position));
      await userEvent.type(screen.getByLabelText(`GTIN da embalagem ${position}`), "7891000100103");
    }
    await fill();

    expect(await screen.findByText("Cada GTIN só pode aparecer em uma embalagem.")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("hands over the product it registered", async () => {
    const onCreated = vi.fn();
    const bread = aProduct({ description: "Pão francês", kind: "MANUFACTURED" });
    createMock.mockResolvedValue({ ok: true, data: bread });

    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} onCreated={onCreated} />);
    await fill();

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(bread));
  });

  it("registers the product and closes", async () => {
    const onOpenChange = vi.fn();

    renderWithProviders(<ProductDialog open onOpenChange={onOpenChange} />);
    await fill({ packaging: { content: "380", unit: "g", gtin: "7891000100103" } });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        description: "FARINHA DE TRIGO",
        kind: "GOODS",
        unit: "KILOGRAM",
        isStorableOnceOpened: true,
        packagings: [{ content: "380", unit: "GRAM", gtin: "7891000100103" }],
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("leaves out a GTIN that was not typed", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    await fill({ packaging: { content: "1,5" } });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        description: "FARINHA DE TRIGO",
        kind: "GOODS",
        unit: "KILOGRAM",
        isStorableOnceOpened: true,
        packagings: [{ content: "1.5", unit: "KILOGRAM" }],
      }),
    );
  });

  it("registers a loose product without a packaging list", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    await fill();

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        description: "FARINHA DE TRIGO",
        kind: "GOODS",
        unit: "KILOGRAM",
        isStorableOnceOpened: true,
      }),
    );
  });

  it.each([
    [PRODUCT_CONFLICTS.description, "Já existe um produto com essa descrição."],
    [PRODUCT_CONFLICTS.gtin, "Esse GTIN já está em outra embalagem."],
    [PRODUCT_CONFLICTS.content, "O produto já tem uma embalagem com esse conteúdo."],
    [PRODUCT_CONFLICTS.inUse, "Essa embalagem já recebeu entradas e não pode ser removida; inative-a."],
    [
      PRODUCT_CONFLICTS.contentLocked,
      "Essa embalagem já recebeu entradas e o conteúdo dela não pode mudar; cadastre uma nova embalagem.",
    ],
  ])("says what the conflict %j is, in Portuguese, and keeps the dialog open", async (message, shown) => {
    const onOpenChange = vi.fn();
    createMock.mockResolvedValue({ ok: false, status: 409, message });

    renderWithProviders(<ProductDialog open onOpenChange={onOpenChange} />);
    await fill();

    expect(await screen.findByRole("alert")).toHaveTextContent(shown);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it.each([
    [
      400,
      PRODUCT_REFUSALS.contentTooFine,
      "O conteúdo da embalagem tem mais casas do que a unidade do produto guarda.",
    ],
    [400, PRODUCT_REFUSALS.unitMismatch, "A unidade da embalagem não mede esse produto."],
    [404, PRODUCT_REFUSALS.packagingNotFound, "Essa embalagem não existe mais. Feche o produto e abra de novo."],
  ] as const)("says what the refusal %i %j is, in Portuguese", async (status, message, shown) => {
    createMock.mockResolvedValue({ ok: false, status, message });

    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    await fill();

    expect(await screen.findByRole("alert")).toHaveTextContent(shown);
  });

  it("leaves a word being composed alone, and writes it in upper case once composed", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    const description = screen.getByLabelText("Descrição") as HTMLInputElement;

    fireEvent.compositionStart(description);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(description, "açu");
    description.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));

    expect(description).toHaveValue("açu");

    fireEvent.compositionEnd(description);

    expect(description).toHaveValue("AÇU");
  });

  it("opens empty again after a product was typed and the dialog closed", async () => {
    const { rerender } = renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    await userEvent.type(screen.getByLabelText("Descrição"), "Farinha");

    rerender(<ProductDialog open={false} onOpenChange={() => undefined} />);
    rerender(<ProductDialog open onOpenChange={() => undefined} />);

    expect(await screen.findByLabelText("Descrição")).toHaveValue("");
  });

  it("registers a product whose leftover is lost once opened", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    const keeps = screen.getByRole("checkbox", { name: "Pode ser guardado depois de aberto" });
    expect(keeps).toBeChecked();
    await userEvent.click(keeps);
    await fill();

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isStorableOnceOpened: false })),
    );
  });

  it("registers the minimum quantity the stock should keep, in the unit chosen", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText("Unidade"), "Quilograma (kg)");
    expect(screen.getByText("kg", { selector: "span" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Estoque mínimo (opcional)"), "12,5");
    await fill();

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        description: "FARINHA DE TRIGO",
        kind: "GOODS",
        unit: "KILOGRAM",
        isStorableOnceOpened: true,
        minimumQuantity: "12.5",
      }),
    );
  });

  it("refuses a minimum quantity of zero", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    await userEvent.type(screen.getByLabelText("Estoque mínimo (opcional)"), "0");
    await fill();

    expect(await screen.findByText("O estoque mínimo tem de ser maior que zero.")).toBeInTheDocument();
  });
});

describe("ProductDialog, editing a product", () => {
  const BAG = aPackaging({ id: "018f0000-0000-7000-8000-000000000101", content: "0.38", gtin: "7891000100103" });
  const FLOUR = aProduct({ description: "FARINHA DE TRIGO", minimumQuantity: "1234.5", packagings: [BAG] });
  const SENT_BAG = { id: BAG.id, content: "380", unit: "GRAM", gtin: "7891000100103", isActive: true };

  /** Answers the edit with what was sent, and keeps it to be checked. */
  function editServer() {
    const received: unknown[] = [];

    // The answer echoes the fields that read the same in both shapes; packagings come back as stored.
    updateMock.mockImplementation(async (_sku, { packagings, ...body }) => {
      received.push({ packagings, ...body });
      return { ok: true, data: { ...FLOUR, ...body } };
    });

    return received;
  }

  it("opens with what the product holds, kind and unit locked", async () => {
    renderWithProviders(<ProductDialog product={FLOUR} open onOpenChange={() => undefined} />);

    expect(await screen.findByRole("dialog", { name: "Editar produto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toHaveValue("FARINHA DE TRIGO");
    expect(screen.getByLabelText("Conteúdo da embalagem 1")).toHaveValue("380");
    expect(screen.getByLabelText("Unidade da embalagem 1")).toHaveDisplayValue("g");
    expect(screen.getByLabelText("GTIN da embalagem 1")).toHaveValue("7891000100103");
    expect(screen.queryByRole("button", { name: "Remover embalagem 1" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Estoque mínimo (opcional)")).toHaveValue("1.234,5");
    expect(screen.getByLabelText("Tipo")).toBeDisabled();
    expect(screen.getByLabelText("Tipo")).toHaveDisplayValue("Mercadoria");
    expect(screen.getByLabelText("Unidade")).toBeDisabled();
    expect(screen.getByLabelText("Unidade")).toHaveDisplayValue("Quilograma (kg)");
  });

  it("saves the description, the packagings and the minimum, and closes", async () => {
    const received = editServer();
    const onOpenChange = vi.fn();
    renderWithProviders(<ProductDialog product={FLOUR} open onOpenChange={onOpenChange} />);

    await userEvent.clear(screen.getByLabelText("Descrição"));
    await userEvent.type(screen.getByLabelText("Descrição"), "Farinha integral");
    await userEvent.clear(screen.getByLabelText("Estoque mínimo (opcional)"));
    await userEvent.type(screen.getByLabelText("Estoque mínimo (opcional)"), "8");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(received).toEqual([
        { description: "FARINHA INTEGRAL", minimumQuantity: "8", isStorableOnceOpened: true, packagings: [SENT_BAG] },
      ]),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Left out, an erased GTIN or minimum would survive the edit.
  it("sends an erased GTIN and minimum as null", async () => {
    const received = editServer();
    renderWithProviders(<ProductDialog product={FLOUR} open onOpenChange={() => undefined} />);

    await userEvent.clear(screen.getByLabelText("GTIN da embalagem 1"));
    await userEvent.clear(screen.getByLabelText("Estoque mínimo (opcional)"));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(received).toEqual([
        {
          description: "FARINHA DE TRIGO",
          minimumQuantity: null,
          isStorableOnceOpened: true,
          packagings: [{ ...SENT_BAG, gtin: null }],
        },
      ]),
    );
  });

  it("inactivates a stored packaging and adds a new one", async () => {
    const received = editServer();
    renderWithProviders(<ProductDialog product={FLOUR} open onOpenChange={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Inativar embalagem 1" }));
    expect(screen.getByRole("button", { name: "Reativar embalagem 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Adicionar embalagem" }));
    await userEvent.type(screen.getByLabelText("Conteúdo da embalagem 2"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(received).toEqual([
        {
          description: "FARINHA DE TRIGO",
          minimumQuantity: "1234.5",
          isStorableOnceOpened: true,
          packagings: [
            { ...SENT_BAG, isActive: false },
            { content: "5", unit: "KILOGRAM", gtin: null, isActive: true },
          ],
        },
      ]),
    );
  });

  it("opens a product that is lost once opened unchecked, and saves it checked again", async () => {
    const received = editServer();
    renderWithProviders(
      <ProductDialog product={{ ...FLOUR, isStorableOnceOpened: false }} open onOpenChange={() => undefined} />,
    );

    const keeps = await screen.findByRole("checkbox", { name: "Pode ser guardado depois de aberto" });
    expect(keeps).not.toBeChecked();
    await userEvent.click(keeps);
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(received).toEqual([expect.objectContaining({ isStorableOnceOpened: true })]));
  });

  it("asks for no recipe after an edit", async () => {
    editServer();
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ProductDialog
        product={aProduct({ ...FLOUR, kind: "MANUFACTURED" })}
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("says, in Portuguese, when the product no longer exists", async () => {
    updateMock.mockResolvedValue({ ok: false, status: 404, message: "Product not found." });
    renderWithProviders(<ProductDialog product={FLOUR} open onOpenChange={() => undefined} />);

    await userEvent.click(await screen.findByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Esse produto já não existe mais. Atualize a lista.");
  });
});
