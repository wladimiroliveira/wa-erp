import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, updateUser } from "@/features/users/actions";
import { UserDialog } from "@/features/users/UserDialog";
import type { Role, User } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aRole, aUser } from "@/tests/samples";

vi.mock("@/features/users/actions", () => ({ createUser: vi.fn(), updateUser: vi.fn() }));

const MANAGER = aRole({ id: "018f0000-0000-7000-8000-0000000000aa", name: "Gerente" });

const open = (user: User | null, { roles = [MANAGER] as Role[], onOpenChange = vi.fn() } = {}) =>
  renderWithProviders(<UserDialog user={user} roles={roles} open onOpenChange={onOpenChange} />);

const field = (label: string) => screen.getByLabelText(label, { selector: "input, select" });

beforeEach(() => {
  vi.mocked(createUser).mockReset();
  vi.mocked(updateUser).mockReset();
});

describe("UserDialog, creating", () => {
  it("refuses to submit without name, username and password", async () => {
    open(null);

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Informe o nome.")).toBeInTheDocument();
    expect(screen.getByText("O usuário precisa de pelo menos 3 caracteres.")).toBeInTheDocument();
    expect(screen.getByText("A senha precisa de pelo menos 8 caracteres.")).toBeInTheDocument();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("refuses a username with characters the server does not accept", async () => {
    open(null);

    await userEvent.type(field("Usuário"), "Maria Souza");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(
      await screen.findByText("Use só letras minúsculas, números, ponto, hífen ou sublinhado."),
    ).toBeInTheDocument();
  });

  it("creates the user with the chosen role and extra permissions, and closes", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(createUser).mockResolvedValue({ ok: true, data: aUser() });
    open(null, { onOpenChange });

    await userEvent.type(field("Nome"), "Maria Souza");
    await userEvent.type(field("Usuário"), "maria");
    await userEvent.type(field("Senha"), "12345678");
    await userEvent.selectOptions(field("Papel"), "Gerente");
    await userEvent.click(screen.getByRole("checkbox", { name: "Ver relatórios" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith({
        name: "Maria Souza",
        username: "maria",
        password: "12345678",
        roleId: MANAGER.id,
        extraPermissions: ["REPORTS_READ"],
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("sends no role when none was chosen", async () => {
    vi.mocked(createUser).mockResolvedValue({ ok: true, data: aUser() });
    open(null);

    await userEvent.type(field("Nome"), "Maria Souza");
    await userEvent.type(field("Usuário"), "maria");
    await userEvent.type(field("Senha"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ roleId: null })));
  });

  it("says the username is taken, in Portuguese, and keeps the dialog open", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(createUser).mockResolvedValue({ ok: false, status: 409, message: "taken" });
    open(null, { onOpenChange });

    await userEvent.type(field("Nome"), "Maria Souza");
    await userEvent.type(field("Usuário"), "maria");
    await userEvent.type(field("Senha"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um usuário com esse login.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("UserDialog, editing", () => {
  const maria = aUser({
    id: "018f0000-0000-7000-8000-000000000002",
    name: "Maria Souza",
    username: "maria",
    roleId: MANAGER.id,
    extraPermissions: ["REPORTS_READ"],
    isActive: true,
  });

  it("opens filled, shows the username without letting it change, and asks for no password", () => {
    open(maria);

    expect(field("Nome")).toHaveValue("Maria Souza");
    expect(field("Usuário")).toHaveValue("maria");
    expect(field("Usuário")).toBeDisabled();
    expect(field("Papel")).toHaveValue(MANAGER.id);
    expect(screen.getByRole("checkbox", { name: "Ver relatórios" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Ativo" })).toBeChecked();
    expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
  });

  it("sends the changes, deactivation included", async () => {
    vi.mocked(updateUser).mockResolvedValue({ ok: true, data: maria });
    open(maria);

    await userEvent.selectOptions(field("Papel"), "Sem papel");
    await userEvent.click(screen.getByRole("checkbox", { name: "Ativo" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(maria.id, {
        name: "Maria Souza",
        roleId: null,
        extraPermissions: ["REPORTS_READ"],
        isActive: false,
      }),
    );
  });

  it("says the user or the role is gone when the server answers 404", async () => {
    vi.mocked(updateUser).mockResolvedValue({ ok: false, status: 404, message: "gone" });
    open(maria);

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esse usuário ou o papel escolhido já não existe mais. Atualize a lista.",
    );
  });

  it("explains why one cannot lock oneself out when the server answers 409", async () => {
    vi.mocked(updateUser).mockResolvedValue({ ok: false, status: 409, message: "self" });
    open(maria);

    await userEvent.click(screen.getByRole("checkbox", { name: "Ativo" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Você não pode desativar a própria conta nem tirar de si a permissão de editar usuários.",
    );
  });

  it("shows the reopened user's values, never the previous one's", async () => {
    const { rerender } = open(maria);

    rerender(<UserDialog user={null} roles={[MANAGER]} open={false} onOpenChange={() => undefined} />);
    rerender(
      <UserDialog
        user={aUser({ id: "018f0000-0000-7000-8000-000000000003", name: "João Lima", username: "joao" })}
        roles={[MANAGER]}
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(await screen.findByDisplayValue("João Lima")).toBeInTheDocument();
  });
});
