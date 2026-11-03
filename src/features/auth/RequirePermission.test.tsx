import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequirePermission } from "@/features/auth/RequirePermission";

const session = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("@/server/auth/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/current-user")>()),
  requireUser: async () => ({ id: "0199a1f0-0000-7000-8000-000000000001", permissions: session.permissions }),
}));

/** Stands in for a real screen: its render is what must not happen without the permission. */
const Screen = vi.fn(() => <p>Papéis carregados</p>);

describe("RequirePermission", () => {
  it("renders 403 instead of the screen, and never mounts it", async () => {
    session.permissions = ["CATALOG_READ"];

    render(await RequirePermission({ permission: "ACCESS_READ", children: <Screen /> }));

    expect(screen.getByText("Você não tem permissão para ver esta tela.")).toBeInTheDocument();
    expect(Screen).not.toHaveBeenCalled();
  });

  it("renders the screen when the permission is there", async () => {
    session.permissions = ["ACCESS_READ"];

    render(await RequirePermission({ permission: "ACCESS_READ", children: <Screen /> }));

    expect(screen.getByText("Papéis carregados")).toBeInTheDocument();
  });
});
