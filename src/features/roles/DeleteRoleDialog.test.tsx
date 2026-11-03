import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteRole } from "@/features/roles/actions";
import { DeleteRoleDialog } from "@/features/roles/DeleteRoleDialog";
import { renderWithProviders } from "@/tests/render";
import { aRole } from "@/tests/samples";

vi.mock("@/features/roles/actions", () => ({ deleteRole: vi.fn() }));

beforeEach(() => {
  vi.mocked(deleteRole).mockReset();
});

describe("DeleteRoleDialog", () => {
  it("names the role and warns what deleting it costs", () => {
    renderWithProviders(<DeleteRoleDialog role={aRole({ name: "Gerente" })} onOpenChange={() => undefined} />);

    expect(screen.getByText('Excluir o papel "Gerente"?')).toBeInTheDocument();
    expect(
      screen.getByText("Quem tiver esse papel fica sem as permissões que ele dava. Não dá para desfazer."),
    ).toBeInTheDocument();
  });

  it("deletes on confirmation and closes", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(deleteRole).mockResolvedValue({ ok: true });

    renderWithProviders(<DeleteRoleDialog role={aRole({ id: "role-1" })} onOpenChange={onOpenChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith("role-1"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("treats a role someone else already deleted as done, not as a failure", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(deleteRole).mockResolvedValue({ ok: false, status: 404, message: "Role not found." });

    renderWithProviders(<DeleteRoleDialog role={aRole({ id: "role-1" })} onOpenChange={onOpenChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and explains when the server is at fault", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(deleteRole).mockRejectedValue(new Error("fetch failed"));

    renderWithProviders(<DeleteRoleDialog role={aRole({ id: "role-1" })} onOpenChange={onOpenChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Excluir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível concluir a operação.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
