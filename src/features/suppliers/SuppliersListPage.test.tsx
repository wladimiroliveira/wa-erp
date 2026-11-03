import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupplier } from "@/features/suppliers/actions";
import { SuppliersListPage } from "@/features/suppliers/SuppliersListPage";
import type { Permission, Supplier } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aSupplier } from "@/tests/samples";

vi.mock("@/features/suppliers/actions", () => ({ createSupplier: vi.fn() }));

const createMock = vi.mocked(createSupplier);

function renderPage(
  suppliers: Supplier[] = [aSupplier()],
  permissions: Permission[] = ["CATALOG_READ", "CATALOG_CREATE"],
  tableLayouts = [],
) {
  return renderWithProviders(<SuppliersListPage suppliers={suppliers} />, {
    user: aCurrentUser({ permissions }),
    tableLayouts,
  });
}

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ ok: true, data: aSupplier() });
});

describe("SuppliersListPage", () => {
  it("lists the suppliers", async () => {
    renderPage([aSupplier({ name: "Moinho Santa Clara" })]);

    expect(await screen.findByRole("cell", { name: "Moinho Santa Clara" })).toBeInTheDocument();
  });

  it("offers the registration as an icon button in the row of the count", async () => {
    renderPage();

    const create = await screen.findByRole("button", { name: "Novo fornecedor" });
    expect(create).toHaveTextContent("");
    expect(create.closest("div")).toContainElement(screen.getByText("1 fornecedor"));
  });

  it("still offers the registration when the list is empty", async () => {
    renderPage([]);

    await screen.findByText("Nenhum fornecedor cadastrado ainda.");
    expect(screen.getByRole("button", { name: "Novo fornecedor" })).toBeInTheDocument();
  });

  it("says there are no suppliers instead of showing a bare table", async () => {
    renderPage([]);

    expect(await screen.findByText("Nenhum fornecedor cadastrado ainda.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("hides the registration from whoever may only read the catalog", async () => {
    renderPage([aSupplier()], ["CATALOG_READ"]);

    await screen.findByRole("cell", { name: "Moinho Santa Clara" });
    expect(screen.queryByRole("button", { name: "Novo fornecedor" })).not.toBeInTheDocument();
  });

  it("registers a supplier from the list and closes the dialog", async () => {
    renderPage([]);

    await userEvent.click(await screen.findByRole("button", { name: "Novo fornecedor" }));
    await userEvent.type(await screen.findByLabelText("Nome"), "Laticínio Boa Vista");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: "Laticínio Boa Vista" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("SuppliersListPage layout", () => {
  it("gives the table the height left on the screen", async () => {
    renderPage();

    await screen.findByRole("cell", { name: "Moinho Santa Clara" });
    expect(screen.getByRole("table").parentElement).toHaveAttribute("data-fill", "true");
  });
});

describe("SuppliersListPage columns", () => {
  // Its one column is also the last, so it fills the container; the saved width sets the least the table takes.
  it("sizes the table to the width the user dragged its column to", async () => {
    renderWithProviders(<SuppliersListPage suppliers={[aSupplier()]} />, {
      tableLayouts: [{ tableKey: "suppliers", order: [], widths: { name: 300 } }],
    });

    await waitFor(() => expect(screen.getByRole("table")).toHaveStyle({ width: "300px", minWidth: "100%" }));
  });
});
