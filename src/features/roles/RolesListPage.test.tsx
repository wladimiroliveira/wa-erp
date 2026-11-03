import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteRole } from "@/features/roles/actions";
import { RolesListPage } from "@/features/roles/RolesListPage";
import type { Role } from "@/lib/api";
import { renderWithProviders, type RenderOptions } from "@/tests/render";
import { chooseRowAction } from "@/tests/row-actions";
import { columnHeaders } from "@/tests/table-layouts";
import { aCurrentUser, aRole } from "@/tests/samples";

vi.mock("@/features/roles/actions", () => ({
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));

const manager = aCurrentUser({ permissions: ["ACCESS_READ", "ACCESS_CREATE", "ACCESS_UPDATE"] });

const open = (roles: Role[], options: RenderOptions = {}) =>
  renderWithProviders(<RolesListPage roles={roles} />, { user: manager, ...options });

beforeEach(() => {
  vi.mocked(deleteRole).mockReset();
});

describe("RolesListPage", () => {
  it("lists each role with its permissions named in Portuguese", () => {
    open([aRole({ id: "role-1", name: "Gerente", permissions: ["ACCESS_READ"] })]);

    expect(screen.getByText("Gerente")).toBeInTheDocument();
    expect(screen.getByText("Ver usuários e papéis")).toBeInTheDocument();
  });

  it("offers the registration as an icon button in the row of the count", () => {
    open([aRole({ name: "Gerente" })]);

    const create = screen.getByRole("button", { name: "Novo papel" });
    expect(create).toHaveTextContent("");
    expect(create.closest("div")).toContainElement(screen.getByText("1 papel"));
  });

  it("still offers the registration when the list is empty", () => {
    open([]);

    expect(screen.getByText("Nenhum papel cadastrado ainda.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo papel" })).toBeInTheDocument();
  });

  it("says the list is empty instead of showing a bare table", () => {
    open([]);

    expect(screen.getByText("Nenhum papel cadastrado ainda.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("opens the dialog filled with the role whose row was clicked", async () => {
    open([aRole({ id: "role-1", name: "Gerente" })]);

    await chooseRowAction("Ações de Gerente", "Editar");

    expect(await screen.findByLabelText("Nome", { selector: "input" })).toHaveValue("Gerente");
  });

  it("asks the server to delete the role whose row was confirmed", async () => {
    vi.mocked(deleteRole).mockResolvedValue({ ok: true });
    open([aRole({ id: "role-1", name: "Gerente" })]);

    await chooseRowAction("Ações de Gerente", "Excluir");
    await userEvent.click(await screen.findByRole("button", { name: "Excluir" }));

    // The row leaves with the next render of the server page, which the dialog asks for.
    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith("role-1"));
  });
});

describe("RolesListPage layout", () => {
  it("gives the table the height left on the screen", () => {
    open([aRole({ name: "Gerente" })]);

    expect(screen.getByRole("table").parentElement).toHaveAttribute("data-fill", "true");
  });
});

describe("RolesListPage columns", () => {
  it("shows the columns in the order the user arranged them", async () => {
    open([aRole()], { tableLayouts: [{ tableKey: "roles", order: ["permissions", "name"], widths: {} }] });

    await waitFor(() => expect(columnHeaders()[0]).toBe("Permissões"));
  });
});
