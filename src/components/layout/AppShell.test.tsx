import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { PageTitle } from "@/components/layout/PageTitle";
import { signOut } from "@/features/auth/actions";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser } from "@/tests/samples";

vi.mock("@/features/auth/actions", () => ({ signOut: vi.fn(async () => {}) }));

describe("AppShell", () => {
  it("shows who is signed in", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ name: "Ana" }) });

    expect(await screen.findByText("Ana")).toBeInTheDocument();
  });

  it("hides a destination the operator may not open", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["CATALOG_READ"] }) });

    expect(screen.queryByRole("link", { name: "Papéis" })).not.toBeInTheDocument();
  });

  it("offers a destination the operator may open", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["ACCESS_READ"] }) });

    expect(await screen.findByRole("link", { name: "Papéis" })).toHaveAttribute("href", "/roles");
  });

  it("offers the users and the permissions to whoever may read the access control", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["ACCESS_READ"] }) });

    expect(await screen.findByRole("link", { name: "Usuários" })).toHaveAttribute("href", "/users");
    expect(await screen.findByRole("link", { name: "Permissões" })).toHaveAttribute("href", "/permissions");
  });

  it("offers the entries screen to whoever may record an entry", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["ENTRIES_CREATE"] }) });

    expect(await screen.findByRole("link", { name: "Entradas" })).toHaveAttribute("href", "/entries");
  });

  it("offers the recipes to whoever may edit the catalog", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["CATALOG_UPDATE"] }) });

    expect(await screen.findByRole("link", { name: "Receitas" })).toHaveAttribute("href", "/recipes");
  });

  it("offers the catalog to whoever may read it", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["CATALOG_READ"] }) });

    expect(await screen.findByRole("link", { name: "Produtos" })).toHaveAttribute("href", "/products");
  });

  it("offers the movement history to whoever may read the entries", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["ENTRIES_READ"] }) });

    expect(await screen.findByRole("link", { name: "Movimentações" })).toHaveAttribute("href", "/stock-movements");
  });

  it("offers the stock analysis to whoever may read the reports", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["REPORTS_READ"] }) });

    expect(await screen.findByRole("link", { name: "Estoque" })).toHaveAttribute("href", "/stock");
  });

  it("offers the suppliers to whoever may read the catalog", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["CATALOG_READ"] }) });

    expect(await screen.findByRole("link", { name: "Fornecedores" })).toHaveAttribute("href", "/suppliers");
  });

  it("offers the loss reasons to whoever may manage them", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["LOSSES_UPDATE"] }) });

    expect(await screen.findByRole("link", { name: "Modalidades de avaria" })).toHaveAttribute("href", "/loss-reasons");
  });

  it("offers the pre-weighings to whoever may read the production", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["PRODUCTION_READ"] }) });

    expect(await screen.findByRole("link", { name: "Pré-pesagens" })).toHaveAttribute("href", "/pre-weighings");
  });

  it("folds the menu away on request, widening the workspace", async () => {
    const { container } = renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser() });
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toHaveAttribute("data-state", "expanded");

    await userEvent.click(screen.getByRole("button", { name: "Alternar menu lateral" }));

    expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });

  it("shows the title of the current screen in the top bar, and only there", async () => {
    const { container } = renderWithProviders(
      <AppShell>
        <PageTitle>Produtos em falta</PageTitle>
      </AppShell>,
      { user: aCurrentUser() },
    );

    const topBar = container.querySelector<HTMLElement>('[data-slot="top-bar"]');
    expect(topBar).not.toBeNull();
    expect(within(topBar!).getByRole("heading", { name: "Produtos em falta" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Produtos em falta" })).toHaveLength(1);
  });

  it("signs the operator out on request, through the server", async () => {
    renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser() });

    await userEvent.click(screen.getByRole("button", { name: "Sair" }));

    // The action ends the session and redirects; the shell only has to ask it.
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

describe("AppShell layout", () => {
  it("holds the screen to the height of the window, scrolling only the content under the top bar", async () => {
    const { container } = renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser() });

    expect(container.querySelector('[data-slot="sidebar-inset"]')).toHaveClass("h-svh");
    expect(container.querySelector('[data-slot="page-content"]')).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
  });
});

describe("AppShell sizing", () => {
  it("keeps the menu as compact as the rest of the controls, folded as well as open", async () => {
    const { container } = renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser() });

    for (const button of container.querySelectorAll('[data-slot="sidebar-menu-button"]')) {
      expect(button).not.toHaveClass("h-11");
    }
    expect(screen.getByRole("button", { name: "Alternar menu lateral" })).toHaveClass("size-8");
    expect(screen.getByRole("link", { name: "wa-system" })).toHaveClass("min-h-8");
    expect(
      container
        .querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')!
        .style.getPropertyValue("--sidebar-width-icon"),
    ).toBe("3rem");
  });
});
