import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signIn } from "@/features/auth/actions";
import { LoginPage } from "@/features/auth/LoginPage";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";

vi.mock("@/features/auth/actions", () => ({ signIn: vi.fn() }));

const signInMock = vi.mocked(signIn);

function renderLogin(route = "/login") {
  return renderWithProviders(<LoginPage />, { route });
}

async function submit(username = "operador", password = "secret123") {
  await userEvent.type(screen.getByLabelText("Usuário"), username);
  await userEvent.type(screen.getByLabelText("Senha"), password);
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

beforeEach(() => {
  signInMock.mockReset();
});

describe("LoginPage", () => {
  it("refuses to call the server with empty fields", async () => {
    renderLogin();

    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("Informe o usuário.")).toBeInTheDocument();
    expect(screen.getByText("Informe a senha.")).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("takes the operator to the application after a successful sign-in", async () => {
    signInMock.mockResolvedValue({ ok: true });

    renderLogin();
    await submit();

    expect(signInMock).toHaveBeenCalledWith({ username: "operador", password: "secret123" });
    await waitFor(() => expect(navigation.url).toBe("/"));
  });

  it("goes back to the screen the operator was sent here from", async () => {
    signInMock.mockResolvedValue({ ok: true });

    renderLogin("/login?from=%2Fstock%2Fsku-1");
    await submit();

    await waitFor(() => expect(navigation.url).toBe("/stock/sku-1"));
  });

  // A return address outside this application is not a place to send a freshly signed-in operator.
  it("ignores a return address that leads off the application", async () => {
    signInMock.mockResolvedValue({ ok: true });

    renderLogin("/login?from=https%3A%2F%2Fevil.test%2F");
    await submit();

    await waitFor(() => expect(navigation.url).toBe("/"));
  });

  it("says the credentials are wrong, in Portuguese, without echoing the server", async () => {
    signInMock.mockResolvedValue({ ok: false, status: 401, message: "Invalid credentials." });

    renderLogin();
    await submit("operador", "wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent("Usuário ou senha inválidos.");
    expect(screen.queryByText(/Invalid credentials/)).not.toBeInTheDocument();
  });

  it("says to wait a minute after the sign-in attempts run out", async () => {
    signInMock.mockResolvedValue({ ok: false, status: 429, message: "Too many attempts." });

    renderLogin();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Muitas tentativas. Espere um minuto e tente de novo.");
  });

  it("explains a failed call differently from a wrong password", async () => {
    signInMock.mockRejectedValue(new Error("fetch failed"));

    renderLogin();
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível concluir a operação. Tente de novo.");
  });
});
