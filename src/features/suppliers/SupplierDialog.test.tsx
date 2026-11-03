import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupplier } from "@/features/suppliers/actions";
import { SupplierDialog } from "@/features/suppliers/SupplierDialog";
import { renderWithProviders } from "@/tests/render";
import { aSupplier } from "@/tests/samples";

vi.mock("@/features/suppliers/actions", () => ({ createSupplier: vi.fn() }));

const createMock = vi.mocked(createSupplier);

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ ok: true, data: aSupplier() });
});

describe("SupplierDialog", () => {
  it("refuses a supplier with no name", async () => {
    renderWithProviders(<SupplierDialog open onOpenChange={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Informe o nome do fornecedor.")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("registers the supplier and closes", async () => {
    const onOpenChange = vi.fn();

    renderWithProviders(<SupplierDialog open onOpenChange={onOpenChange} />);

    await userEvent.type(screen.getByLabelText("Nome"), "Moinho Santa Clara");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: "Moinho Santa Clara" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says the name is taken, in Portuguese, and keeps the dialog open", async () => {
    const onOpenChange = vi.fn();
    createMock.mockResolvedValue({ ok: false, status: 409, message: "A supplier with this name already exists." });

    renderWithProviders(<SupplierDialog open onOpenChange={onOpenChange} />);

    await userEvent.type(screen.getByLabelText("Nome"), "Moinho Santa Clara");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um fornecedor com esse nome.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("opens empty again after a name was typed and the dialog closed", async () => {
    const { rerender } = renderWithProviders(<SupplierDialog open onOpenChange={() => undefined} />);

    await userEvent.type(screen.getByLabelText("Nome"), "Moinho");

    rerender(<SupplierDialog open={false} onOpenChange={() => undefined} />);
    rerender(<SupplierDialog open onOpenChange={() => undefined} />);

    expect(await screen.findByLabelText("Nome")).toHaveValue("");
  });
});
