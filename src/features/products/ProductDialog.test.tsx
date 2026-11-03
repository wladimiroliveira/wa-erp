import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProduct, updateProduct } from "@/features/products/actions";
import { ProductDialog } from "@/features/products/ProductDialog";
import { renderWithProviders } from "@/tests/render";
import { aProduct } from "@/tests/samples";

vi.mock("@/features/products/actions", () => ({ createProduct: vi.fn(), updateProduct: vi.fn() }));

const createMock = vi.mocked(createProduct);
const updateMock = vi.mocked(updateProduct);

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ ok: true, data: aProduct() });
  updateMock.mockReset();
});

async function fill({ description = "Farinha de trigo", gtin = "" } = {}) {
  await userEvent.type(screen.getByLabelText("Descrição"), description);
  await userEvent.selectOptions(screen.getByLabelText("Tipo"), "Mercadoria");
  await userEvent.selectOptions(screen.getByLabelText("Unidade"), "Quilograma (kg)");
  if (gtin !== "") await userEvent.type(screen.getByLabelText("GTIN (opcional)"), gtin);
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

    await fill({ gtin: "789-1000" });

    expect(await screen.findByText("O GTIN tem de 8 a 14 dígitos, só números.")).toBeInTheDocument();
  });

  it("refuses a GTIN whose check digit does not match", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    await fill({ gtin: "7891000100104" });

    expect(await screen.findByText("O dígito verificador do GTIN não confere. Revise o código.")).toBeInTheDocument();
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
    await fill({ gtin: "7891000100103" });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        description: "Farinha de trigo",
        kind: "GOODS",
        unit: "KILOGRAM",
        gtin: "7891000100103",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("leaves the GTIN out of the request when it was not typed", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    await fill();

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ description: "Farinha de trigo", kind: "GOODS", unit: "KILOGRAM" }),
    );
  });

  it("says the product is already in the catalog, in Portuguese, and keeps the dialog open", async () => {
    const onOpenChange = vi.fn();
    createMock.mockResolvedValue({
      ok: false,
      status: 409,
      message: "A product with this description already exists.",
    });

    renderWithProviders(<ProductDialog open onOpenChange={onOpenChange} />);
    await fill();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Já existe um produto com essa descrição ou com esse GTIN.",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("opens empty again after a product was typed and the dialog closed", async () => {
    const { rerender } = renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);

    await userEvent.type(screen.getByLabelText("Descrição"), "Farinha");

    rerender(<ProductDialog open={false} onOpenChange={() => undefined} />);
    rerender(<ProductDialog open onOpenChange={() => undefined} />);

    expect(await screen.findByLabelText("Descrição")).toHaveValue("");
  });

  it("registers the minimum quantity the stock should keep, in the unit chosen", async () => {
    renderWithProviders(<ProductDialog open onOpenChange={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText("Unidade"), "Quilograma (kg)");
    expect(screen.getByText("kg", { selector: "span" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Estoque mínimo (opcional)"), "12,5");
    await fill();

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        description: "Farinha de trigo",
        kind: "GOODS",
        unit: "KILOGRAM",
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
  const FLOUR = aProduct({ gtin: "7891000100103", minimumQuantity: "1234.5" });

  /** Answers the edit with what was sent, and keeps it to be checked. */
  function editServer() {
    const received: unknown[] = [];

    updateMock.mockImplementation(async (_sku, body) => {
      received.push(body);
      return { ok: true, data: { ...FLOUR, ...body } };
    });

    return received;
  }

  it("opens with what the product holds, kind and unit locked", async () => {
    renderWithProviders(<ProductDialog product={FLOUR} open onOpenChange={() => undefined} />);

    expect(await screen.findByRole("dialog", { name: "Editar produto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toHaveValue("Farinha de trigo");
    expect(screen.getByLabelText("GTIN (opcional)")).toHaveValue("7891000100103");
    expect(screen.getByLabelText("Estoque mínimo (opcional)")).toHaveValue("1.234,5");
    expect(screen.getByLabelText("Tipo")).toBeDisabled();
    expect(screen.getByLabelText("Tipo")).toHaveDisplayValue("Mercadoria");
    expect(screen.getByLabelText("Unidade")).toBeDisabled();
    expect(screen.getByLabelText("Unidade")).toHaveDisplayValue("Quilograma (kg)");
  });

  it("saves the description, the GTIN and the minimum, and closes", async () => {
    const received = editServer();
    const onOpenChange = vi.fn();
    renderWithProviders(<ProductDialog product={FLOUR} open onOpenChange={onOpenChange} />);

    await userEvent.clear(screen.getByLabelText("Descrição"));
    await userEvent.type(screen.getByLabelText("Descrição"), "Farinha integral");
    await userEvent.clear(screen.getByLabelText("Estoque mínimo (opcional)"));
    await userEvent.type(screen.getByLabelText("Estoque mínimo (opcional)"), "8");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(received).toEqual([{ description: "Farinha integral", gtin: "7891000100103", minimumQuantity: "8" }]),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Left out, an erased GTIN or minimum would survive the edit.
  it("sends an erased GTIN and minimum as null", async () => {
    const received = editServer();
    renderWithProviders(<ProductDialog product={FLOUR} open onOpenChange={() => undefined} />);

    await userEvent.clear(screen.getByLabelText("GTIN (opcional)"));
    await userEvent.clear(screen.getByLabelText("Estoque mínimo (opcional)"));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(received).toEqual([{ description: "Farinha de trigo", gtin: null, minimumQuantity: null }]),
    );
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
