import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PermissionsListPage } from "@/features/permissions/PermissionsListPage";
import type { Role } from "@/lib/api";
import { PERMISSIONS } from "@/lib/permissions";
import { renderWithProviders, type RenderOptions } from "@/tests/render";
import { columnHeaders } from "@/tests/table-layouts";
import { aCurrentUser, aRole } from "@/tests/samples";

const viewer = aCurrentUser({ permissions: ["ACCESS_READ"] });

const open = (roles: Role[] = [], options: RenderOptions = {}) =>
  renderWithProviders(<PermissionsListPage roles={roles} />, { user: viewer, ...options });

const rowOf = (code: string) => screen.getByText(code).closest("tr") as HTMLElement;

describe("PermissionsListPage", () => {
  it("lists every permission the system knows", () => {
    open();

    expect(screen.getByText(`${PERMISSIONS.length} permissões`)).toBeInTheDocument();
    for (const permission of PERMISSIONS) expect(screen.getByText(permission)).toBeInTheDocument();
  });

  it("names each permission in Portuguese next to its group", () => {
    open();

    const row = rowOf("REPORTS_READ");
    expect(within(row).getByText("Ver relatórios")).toBeInTheDocument();
    expect(within(row).getByText("Relatórios")).toBeInTheDocument();
  });

  it("names the roles that grant each permission", () => {
    open([
      aRole({ id: "r1", name: "Gerente", permissions: ["REPORTS_READ", "ACCESS_READ"] }),
      aRole({ id: "r2", name: "Caixa", permissions: ["SALES_CREATE"] }),
    ]);

    expect(within(rowOf("REPORTS_READ")).getByText("Gerente")).toBeInTheDocument();
    expect(within(rowOf("REPORTS_READ")).queryByText("Caixa")).not.toBeInTheDocument();
    expect(within(rowOf("SALES_CREATE")).getByText("Caixa")).toBeInTheDocument();
  });

  it("says when no role grants a permission", () => {
    open([aRole({ name: "Gerente", permissions: ["ACCESS_READ"] })]);

    expect(within(rowOf("CATALOG_READ")).getByText("Nenhum papel")).toBeInTheDocument();
  });
});

describe("PermissionsListPage columns", () => {
  it("shows the columns in the order the user arranged them", async () => {
    open([], { tableLayouts: [{ tableKey: "permissions", order: ["roles", "group", "label", "code"], widths: {} }] });

    await waitFor(() => expect(columnHeaders()[0]).toBe("Papéis"));
  });
});
