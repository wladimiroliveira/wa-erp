import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoss } from "@/features/losses/actions";
import { LossDialog } from "@/features/losses/LossDialog";
import { renderWithProviders } from "@/tests/render";
import { aLoss, aLossReason, aStockLot } from "@/tests/samples";

vi.mock("@/features/losses/actions", () => ({ createLoss: vi.fn() }));

const createLossMock = vi.mocked(createLoss);

const LOT = aStockLot({ id: "lot-1", quantity: "10", expiresAt: "2026-10-01" });
const REASONS = [
  aLossReason({ id: "reason-1", name: "Vencimento" }),
  aLossReason({ id: "reason-2", name: "Quebra", isActive: false }),
];

const dialog = (onOpenChange: (open: boolean) => void = () => undefined) => (
  <LossDialog lot={LOT} unit="KILOGRAM" productName="Farinha de trigo" reasons={REASONS} onOpenChange={onOpenChange} />
);

async function fill(quantity: string) {
  await userEvent.selectOptions(await screen.findByLabelText("Modalidade"), "Vencimento");
  await userEvent.type(screen.getByLabelText("Quantidade"), quantity);
}

const submit = () => userEvent.click(screen.getByRole("button", { name: "Registrar avaria" }));

beforeEach(() => {
  createLossMock.mockReset();
});

describe("LossDialog", () => {
  it("says which lot is being written off and how much it holds", async () => {
    renderWithProviders(dialog());

    expect(await screen.findByText(/Farinha de trigo/)).toBeInTheDocument();
    expect(screen.getByText(/validade 01\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/saldo de 10 kg/)).toBeInTheDocument();
  });

  it("shows the lot's unit inside the quantity field", async () => {
    renderWithProviders(dialog());
    await fill("1250,5");

    const field = screen.getByLabelText("Quantidade");
    expect(field).toHaveValue("1.250,5");
    expect(within(field.parentElement!).getByText("kg")).toBeInTheDocument();
  });

  it("offers only the reasons in use", async () => {
    renderWithProviders(dialog());

    expect(await screen.findByRole("option", { name: "Vencimento" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Quebra" })).not.toBeInTheDocument();
  });

  it("refuses a loss with no reason, no quantity, or more than the lot holds", async () => {
    renderWithProviders(dialog());

    await screen.findByRole("option", { name: "Vencimento" });
    await submit();

    expect(await screen.findByText("Escolha a modalidade.")).toBeInTheDocument();
    expect(screen.getByText("Informe a quantidade, com até 6 casas decimais.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Quantidade"), "10,5");
    await submit();

    expect(await screen.findByText("A quantidade não pode passar do saldo do lote.")).toBeInTheDocument();
    expect(createLossMock).not.toHaveBeenCalled();
  });

  it("records the loss with a decimal point and the note, and closes", async () => {
    createLossMock.mockResolvedValue({ ok: true, data: aLoss() });
    const onOpenChange = vi.fn();

    renderWithProviders(dialog(onOpenChange));
    await fill("2,5");
    await userEvent.type(screen.getByLabelText("Observação (opcional)"), "Saco rasgado.");
    await submit();

    await waitFor(() =>
      expect(createLossMock).toHaveBeenCalledWith({
        lotId: "lot-1",
        reasonId: "reason-1",
        quantity: "2.5",
        note: "Saco rasgado.",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("leaves the note out of the request when none was typed", async () => {
    createLossMock.mockResolvedValue({ ok: true, data: aLoss() });

    renderWithProviders(dialog());
    await fill("10");
    await submit();

    await waitFor(() =>
      expect(createLossMock).toHaveBeenCalledWith({ lotId: "lot-1", reasonId: "reason-1", quantity: "10" }),
    );
  });

  it("says the lot no longer holds that much, in Portuguese, and stays open", async () => {
    createLossMock.mockResolvedValue({ ok: false, status: 409, message: "Too much." });
    const onOpenChange = vi.fn();

    renderWithProviders(dialog(onOpenChange));
    await fill("2");
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O lote já não tem esse saldo ou a modalidade foi inativada. Atualize a página.",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
