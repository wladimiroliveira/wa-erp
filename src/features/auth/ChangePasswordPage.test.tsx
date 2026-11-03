import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeOwnPassword } from "@/features/auth/actions";
import { ChangePasswordPage } from "@/features/auth/ChangePasswordPage";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";

vi.mock("@/features/auth/actions", () => ({ changeOwnPassword: vi.fn() }));

const changeMock = vi.mocked(changeOwnPassword);

function renderPage() {
  return renderWithProviders(<ChangePasswordPage />, { route: "/change-password" });
}

async function fill(current: string, next: string, confirmation: string) {
  await userEvent.type(screen.getByLabelText("Senha atual"), current);
  await userEvent.type(screen.getByLabelText("Nova senha"), next);
  await userEvent.type(screen.getByLabelText("Repita a nova senha"), confirmation);
  await userEvent.click(screen.getByRole("button", { name: "Trocar a senha" }));
}

beforeEach(() => {
  changeMock.mockReset();
});

describe("ChangePasswordPage", () => {
  it("refuses a new password shorter than the server accepts, without asking the server", async () => {
    renderPage();

    await fill("old-secret", "short", "short");

    expect(await screen.findByText("A nova senha precisa de pelo menos 8 caracteres.")).toBeInTheDocument();
    expect(changeMock).not.toHaveBeenCalled();
  });

  it("refuses a confirmation that does not match", async () => {
    renderPage();

    await fill("old-secret", "new-secret-1", "new-secret-2");

    expect(await screen.findByText("As senhas não conferem.")).toBeInTheDocument();
  });

  it("says the current password is wrong, in Portuguese, and stays on the screen", async () => {
    changeMock.mockResolvedValue({ ok: false, status: 401, message: "Invalid credentials." });
    renderPage();

    await fill("wrong-secret", "new-secret-1", "new-secret-1");

    expect(await screen.findByRole("alert")).toHaveTextContent("A senha atual não confere.");
    expect(navigation.url).toBe("/change-password");
  });

  it("sends the operator to sign in again after the change, because every session was revoked", async () => {
    changeMock.mockResolvedValue({ ok: true });
    renderPage();

    await fill("old-secret", "new-secret-1", "new-secret-1");

    expect(changeMock).toHaveBeenCalledWith({ currentPassword: "old-secret", newPassword: "new-secret-1" });
    await waitFor(() => expect(navigation.url).toBe("/login"));
  });
});
