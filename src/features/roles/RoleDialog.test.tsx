import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRole, updateRole } from "@/features/roles/actions";
import { RoleDialog } from "@/features/roles/RoleDialog";
import { renderWithProviders } from "@/tests/render";
import { aRole } from "@/tests/samples";

vi.mock("@/features/roles/actions", () => ({ createRole: vi.fn(), updateRole: vi.fn() }));

beforeEach(() => {
  vi.mocked(createRole).mockReset();
  vi.mocked(updateRole).mockReset();
});

describe("RoleDialog", () => {
  it("refuses to submit a role with no name and no permission", async () => {
    renderWithProviders(<RoleDialog role={null} open onOpenChange={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Informe o nome do papel.")).toBeInTheDocument();
    expect(screen.getByText("Escolha ao menos uma permissão.")).toBeInTheDocument();
    expect(createRole).not.toHaveBeenCalled();
  });

  it("creates a role with the chosen permissions and closes", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(createRole).mockResolvedValue({ ok: true, data: aRole() });

    renderWithProviders(<RoleDialog role={null} open onOpenChange={onOpenChange} />);

    await userEvent.type(screen.getByLabelText("Nome"), "Produção");
    await userEvent.click(screen.getByRole("checkbox", { name: "Registrar produção" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createRole).toHaveBeenCalledWith({ name: "Produção", permissions: ["PRODUCTION_CREATE"] }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("opens already filled when editing, and sends the change", async () => {
    vi.mocked(updateRole).mockResolvedValue({ ok: true, data: aRole({ id: "role-1", name: "Gerência" }) });

    renderWithProviders(
      <RoleDialog
        role={aRole({ id: "role-1", name: "Gerente", permissions: ["ACCESS_READ"] })}
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Nome")).toHaveValue("Gerente");
    expect(screen.getByRole("checkbox", { name: "Ver usuários e papéis" })).toBeChecked();

    await userEvent.clear(screen.getByLabelText("Nome"));
    await userEvent.type(screen.getByLabelText("Nome"), "Gerência");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith("role-1", { name: "Gerência", permissions: ["ACCESS_READ"] }),
    );
  });

  it("says the name is taken, in Portuguese, and keeps the dialog open", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(createRole).mockResolvedValue({
      ok: false,
      status: 409,
      message: "A role with this name already exists.",
    });

    renderWithProviders(<RoleDialog role={null} open onOpenChange={onOpenChange} />);

    await userEvent.type(screen.getByLabelText("Nome"), "Gerente");
    await userEvent.click(screen.getByRole("checkbox", { name: "Ver usuários e papéis" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um papel com esse nome.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("shows the reopened role's values, never the previous one's", async () => {
    const { rerender } = renderWithProviders(
      <RoleDialog role={aRole({ id: "role-1", name: "Gerente" })} open onOpenChange={() => undefined} />,
    );

    expect(screen.getByLabelText("Nome")).toHaveValue("Gerente");

    // Closing and reopening for a different role is the sequence that breaks a form
    // built once and never reset — the values would still be the first role's.
    rerender(<RoleDialog role={null} open={false} onOpenChange={() => undefined} />);
    rerender(<RoleDialog role={aRole({ id: "role-2", name: "Produção" })} open onOpenChange={() => undefined} />);

    expect(await screen.findByLabelText("Nome")).toHaveValue("Produção");
  });
});

describe("RoleDialog sizing", () => {
  it("lists the permissions in rows as tall as a control", () => {
    renderWithProviders(<RoleDialog role={null} open onOpenChange={() => undefined} />);

    const label = document.querySelector('label[for^="permission-"]')!;

    expect(label).toHaveClass("py-1.5");
    expect(label.parentElement).toHaveClass("min-h-8");
  });
});
