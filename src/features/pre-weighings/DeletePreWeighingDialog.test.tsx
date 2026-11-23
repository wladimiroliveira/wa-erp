import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deletePreWeighing } from "@/features/pre-weighings/actions";
import { DeletePreWeighingDialog } from "@/features/pre-weighings/DeletePreWeighingDialog";
import { navigation } from "@/tests/navigation";
import { renderWithProviders } from "@/tests/render";
import { aPreWeighing } from "@/tests/samples";

vi.mock("@/features/pre-weighings/actions", () => ({ deletePreWeighing: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ID = aPreWeighing().id;

async function openDialog(withStages = false) {
  renderWithProviders(<DeletePreWeighingDialog preWeighingId={ID} withStages={withStages} />, {
    route: `/pre-weighings/${ID}`,
  });
  await userEvent.click(screen.getByRole("button", { name: "Excluir pré-pesagem" }));

  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  vi.mocked(deletePreWeighing).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe("DeletePreWeighingDialog", () => {
  it("warns what deleting does before doing it", async () => {
    const dialog = await openDialog();

    expect(dialog).toHaveTextContent("A pré-pesagem deixa de existir. O estoque não é alterado.");
    expect(dialog).not.toHaveTextContent("intermediários");
    expect(deletePreWeighing).not.toHaveBeenCalled();
  });

  it("warns that the intermediates recorded under it go too", async () => {
    const dialog = await openDialog(true);

    expect(dialog).toHaveTextContent("As pré-pesagens dos intermediários registradas com ela também são excluídas.");
  });

  it("deletes after confirmation and goes back to the list", async () => {
    vi.mocked(deletePreWeighing).mockResolvedValue({ ok: true, data: null });
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    await waitFor(() => expect(deletePreWeighing).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(navigation.pathname).toBe("/pre-weighings"));
    expect(toast.success).toHaveBeenCalledWith("Pré-pesagem excluída.");
  });

  it("does nothing when the operator goes back", async () => {
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deletePreWeighing).not.toHaveBeenCalled();
  });

  it("explains a pre-weighing a production took meanwhile in a message that outlives the dialog", async () => {
    vi.mocked(deletePreWeighing).mockResolvedValue({
      ok: false,
      status: 409,
      message: "The pre-weighing is not pending.",
    });
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Uma produção usa esta pré-pesagem ou uma registrada com ela. A página foi atualizada.",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(navigation.pathname).toBe(`/pre-weighings/${ID}`);
  });
});
