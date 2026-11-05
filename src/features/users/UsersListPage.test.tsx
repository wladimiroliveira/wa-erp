import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UsersListPage } from "@/features/users/UsersListPage";
import type { Role, User } from "@/lib/api";
import { renderWithProviders, type RenderOptions } from "@/tests/render";
import { chooseRowAction } from "@/tests/row-actions";
import { columnHeaders } from "@/tests/table-layouts";
import { aCurrentUser, aRole, aUser } from "@/tests/samples";

vi.mock("@/features/users/actions", () => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
}));

const viewer = aCurrentUser({ permissions: ["ACCESS_READ"] });
const manager = aCurrentUser({ permissions: ["ACCESS_READ", "ACCESS_CREATE", "ACCESS_UPDATE"] });

const open = (users: User[], roles: Role[] = [], options: RenderOptions = {}) =>
  renderWithProviders(<UsersListPage users={users} roles={roles} />, { user: viewer, ...options });

const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

describe("UsersListPage", () => {
  it("lists each user with name and username", () => {
    open([aUser({ name: "Maria Souza", username: "maria" })]);

    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByText("maria")).toBeInTheDocument();
  });

  it("names the role the user holds", () => {
    const role = aRole({ id: "018f0000-0000-7000-8000-0000000000aa", name: "Gerente" });

    open([aUser({ name: "Maria Souza", roleId: role.id })], [role]);

    expect(within(rowOf("Maria Souza")).getByText("Gerente")).toBeInTheDocument();
  });

  it("says when the user holds no role", () => {
    open([aUser({ name: "Maria Souza", roleId: null })]);

    expect(within(rowOf("Maria Souza")).getByText("Sem papel")).toBeInTheDocument();
  });

  it("names the extra permissions in Portuguese", () => {
    open([aUser({ name: "Maria Souza", extraPermissions: ["REPORTS_READ"] })]);

    expect(within(rowOf("Maria Souza")).getByText("Ver relatórios")).toBeInTheDocument();
  });

  it("tells active users apart from inactive ones", () => {
    open([
      aUser({ id: "u1", name: "Maria Souza", isActive: true }),
      aUser({ id: "u2", name: "João Lima", isActive: false }),
    ]);

    expect(within(rowOf("Maria Souza")).getByText("Ativo")).toBeInTheDocument();
    expect(within(rowOf("João Lima")).getByText("Inativo")).toBeInTheDocument();
  });

  it("counts the users", () => {
    open([aUser({ id: "u1" }), aUser({ id: "u2" })]);

    expect(screen.getByText("2 usuários")).toBeInTheDocument();
  });

  it("says the list is empty instead of showing a bare table", () => {
    open([]);

    expect(screen.getByText("Nenhum usuário cadastrado ainda.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("UsersListPage actions", () => {
  it("offers the registration to whoever may create users", () => {
    open([aUser()], [], { user: manager });

    expect(screen.getByRole("button", { name: "Novo usuário" })).toBeInTheDocument();
  });

  it("still offers the registration when the list is empty", () => {
    open([], [], { user: manager });

    expect(screen.getByRole("button", { name: "Novo usuário" })).toBeInTheDocument();
  });

  it("offers neither registration nor row actions to whoever may only read", () => {
    open([aUser({ name: "Maria Souza" })]);

    expect(screen.queryByRole("button", { name: "Novo usuário" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ações de Maria Souza" })).not.toBeInTheDocument();
  });

  it("opens the registration empty", async () => {
    open([aUser()], [], { user: manager });

    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));

    expect(await screen.findByLabelText("Nome", { selector: "input" })).toHaveValue("");
  });

  it("opens the edit dialog filled with the user whose row was clicked", async () => {
    open([aUser({ name: "Maria Souza" })], [], { user: manager });

    await chooseRowAction("Ações de Maria Souza", "Editar");

    expect(await screen.findByLabelText("Nome", { selector: "input" })).toHaveValue("Maria Souza");
  });

  it("opens the password reset for the user whose row was clicked", async () => {
    open([aUser({ name: "Maria Souza" })], [], { user: manager });

    await chooseRowAction("Ações de Maria Souza", "Redefinir senha");

    expect(await screen.findByRole("heading", { name: "Redefinir senha de Maria Souza" })).toBeInTheDocument();
  });
});

describe("UsersListPage columns", () => {
  it("shows the columns in the order the user arranged them", async () => {
    open([aUser()], [], {
      tableLayouts: [
        { tableKey: "users", order: ["username", "name", "role", "extraPermissions", "status"], widths: {} },
      ],
    });

    await waitFor(() => expect(columnHeaders()[0]).toBe("Usuário"));
  });
});
