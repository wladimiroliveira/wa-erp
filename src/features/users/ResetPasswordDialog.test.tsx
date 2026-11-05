import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetUserPassword } from "@/features/users/actions";
import { ResetPasswordDialog } from "@/features/users/ResetPasswordDialog";
import { renderWithProviders } from "@/tests/render";
import { aUser } from "@/tests/samples";

vi.mock("@/features/users/actions", () => ({ resetUserPassword: vi.fn() }));

const maria = aUser({ id: "018f0000-0000-7000-8000-000000000002", name: "Maria Souza" });

const open = (onOpenChange = vi.fn()) =>
  renderWithProviders(<ResetPasswordDialog user={maria} onOpenChange={onOpenChange} />);

beforeEach(() => {
  vi.mocked(resetUserPassword).mockReset();
});

describe("ResetPasswordDialog", () => {
  it("names the user whose password is being reset", () => {
    open();

    expect(screen.getByRole("heading", { name: "Redefinir senha de Maria Souza" })).toBeInTheDocument();
  });

  it("refuses a short password and a confirmation that does not match", async () => {
    open();

    await userEvent.type(screen.getByLabelText("Nova senha"), "short");
    await userEvent.type(screen.getByLabelText("Repita a nova senha"), "other");
    await userEvent.click(screen.getByRole("button", { name: "Redefinir" }));

    expect(await screen.findByText("A senha precisa de pelo menos 8 caracteres.")).toBeInTheDocument();
    expect(screen.getByText("As senhas não conferem.")).toBeInTheDocument();
    expect(resetUserPassword).not.toHaveBeenCalled();
  });

  it("sends the new password and closes", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(resetUserPassword).mockResolvedValue({ ok: true });
    open(onOpenChange);

    await userEvent.type(screen.getByLabelText("Nova senha"), "12345678");
    await userEvent.type(screen.getByLabelText("Repita a nova senha"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Redefinir" }));

    await waitFor(() => expect(resetUserPassword).toHaveBeenCalledWith(maria.id, { newPassword: "12345678" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("says the user is gone when the server answers 404", async () => {
    vi.mocked(resetUserPassword).mockResolvedValue({ ok: false, status: 404, message: "gone" });
    open();

    await userEvent.type(screen.getByLabelText("Nova senha"), "12345678");
    await userEvent.type(screen.getByLabelText("Repita a nova senha"), "12345678");
    await userEvent.click(screen.getByRole("button", { name: "Redefinir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Esse usuário já não existe mais. Atualize a lista.");
  });
});
