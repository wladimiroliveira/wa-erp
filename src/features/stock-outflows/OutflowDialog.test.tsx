import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { quoteOutflow, registerOutflow } from "@/features/stock-outflows/actions";
import { OutflowDialog } from "@/features/stock-outflows/OutflowDialog";
import type { OutflowQuote } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { anOutflow, aProduct } from "@/tests/samples";

vi.mock("@/features/stock-outflows/actions", () => ({ quoteOutflow: vi.fn(), registerOutflow: vi.fn() }));

const quoteMock = vi.mocked(quoteOutflow);
const registerMock = vi.mocked(registerOutflow);

const BREAD = aProduct({
  sku: "018f0000-0000-7000-8000-000000000021",
  description: "Pão francês",
  kind: "MANUFACTURED",
  unit: "UNIT",
});

const QUOTE: OutflowQuote = { listPrice: "13.80", onHandCost: "9.20", available: "10" };

const quoted = (over: Partial<OutflowQuote> = {}) => ({ ok: true as const, data: { ...QUOTE, ...over } });

const CAKE = aProduct({
  sku: "018f0000-0000-7000-8000-000000000022",
  description: "Bolo",
  kind: "MANUFACTURED",
  unit: "UNIT",
});

function renderDialog(onOpenChange: (open: boolean) => void = () => undefined, products = [BREAD]) {
  return renderWithProviders(<OutflowDialog open products={products} onOpenChange={onOpenChange} />);
}

async function chooseProduct() {
  await userEvent.selectOptions(await screen.findByLabelText("Produto"), "Pão francês");
}

async function chooseSale(quantity: string) {
  await chooseProduct();
  await userEvent.click(screen.getByRole("radio", { name: "Venda" }));
  await userEvent.type(screen.getByLabelText("Quantidade"), quantity);
}

const submit = () => userEvent.click(screen.getByRole("button", { name: "Registrar saída" }));

beforeEach(() => {
  quoteMock.mockReset();
  registerMock.mockReset();
  quoteMock.mockResolvedValue(quoted());
});

describe("OutflowDialog", () => {
  it("quotes the product, prefills the price and shows revenue, estimated cost and profit", async () => {
    renderDialog();
    await chooseSale("3");

    await waitFor(() => expect(screen.getByLabelText("Preço")).toHaveValue("13,80"));
    expect(quoteMock).toHaveBeenCalledWith(BREAD.sku);
    expect(screen.getByText("Receita").nextSibling).toHaveTextContent("R$ 41,40");
    expect(screen.getByText("Custo estimado").nextSibling).toHaveTextContent("R$ 27,60");
    expect(screen.getByText("Lucro").nextSibling).toHaveTextContent("R$ 13,80");
  });

  it("recomputes the profit for an edited price and sends it", async () => {
    registerMock.mockResolvedValue({ ok: true, data: anOutflow() });
    renderDialog();
    await chooseSale("3");
    await waitFor(() => expect(screen.getByLabelText("Preço")).toHaveValue("13,80"));

    const price = screen.getByLabelText("Preço");
    await userEvent.clear(price);
    await userEvent.type(price, "12,00");

    expect(screen.getByText("Lucro").nextSibling).toHaveTextContent("R$ 8,40");

    await submit();

    await waitFor(() =>
      expect(registerMock).toHaveBeenCalledWith({
        kind: "SALE",
        productSku: BREAD.sku,
        quantity: "3",
        unitPrice: "12.00",
      }),
    );
  });

  it("hides the price for a donation and shows its cost as a loss", async () => {
    registerMock.mockResolvedValue({ ok: true, data: anOutflow({ kind: "DONATION" }) });
    renderDialog();
    await chooseProduct();
    await userEvent.click(screen.getByRole("radio", { name: "Doação" }));
    await userEvent.type(screen.getByLabelText("Quantidade"), "2");

    expect(screen.queryByLabelText("Preço")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Custo (prejuízo)").nextSibling).toHaveTextContent("R$ 18,40"));

    await submit();

    await waitFor(() =>
      expect(registerMock).toHaveBeenCalledWith({ kind: "DONATION", productSku: BREAD.sku, quantity: "2" }),
    );
  });

  it("disables selling a product that has no price", async () => {
    quoteMock.mockResolvedValue(quoted({ listPrice: null }));
    renderDialog();
    await chooseProduct();

    expect(await screen.findByText("Produto sem preço")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Venda" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Doação" })).toBeEnabled();
  });

  it("sells again after a product without a price is followed by one that has it", async () => {
    quoteMock.mockImplementation(async (sku) => quoted(sku === CAKE.sku ? { listPrice: null } : {}));
    renderDialog(undefined, [CAKE, BREAD]);
    const select = await screen.findByLabelText("Produto");

    await userEvent.selectOptions(select, "Bolo");
    expect(await screen.findByText("Produto sem preço")).toBeInTheDocument();
    await userEvent.selectOptions(select, "Pão francês");

    await waitFor(() => expect(screen.getByLabelText("Preço")).toHaveValue("13,80"));
    expect(screen.getByRole("radio", { name: "Venda" })).toBeChecked();
  });

  it("drops a failure when another product is chosen", async () => {
    registerMock.mockResolvedValue({ ok: false, status: 409, message: "Not enough stock." });
    renderDialog(undefined, [BREAD, CAKE]);
    await chooseSale("3");
    await waitFor(() => expect(screen.getByLabelText("Preço")).toHaveValue("13,80"));
    await submit();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Produto"), "Bolo");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses a quantity above what is available", async () => {
    renderDialog();
    await chooseSale("11");

    expect(await screen.findByText("Estoque insuficiente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar saída" })).toBeDisabled();
  });

  it.each([
    ["Not enough stock.", "Estoque insuficiente."],
    ["The product has no price.", "Produto sem preço."],
    ["Only a manufactured product can be sold.", "Só produto fabricado pode ser vendido."],
    ["Product is inactive.", "Produto inativo."],
  ])("shows %s in Portuguese", async (server, shown) => {
    registerMock.mockResolvedValue({ ok: false, status: 409, message: server });
    renderDialog();
    await chooseSale("3");
    await waitFor(() => expect(screen.getByLabelText("Preço")).toHaveValue("13,80"));

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(shown);
  });

  it("closes and refreshes after a recorded outflow", async () => {
    registerMock.mockResolvedValue({ ok: true, data: anOutflow() });
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);
    await chooseSale("3");
    await waitFor(() => expect(screen.getByLabelText("Preço")).toHaveValue("13,80"));

    await submit();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
