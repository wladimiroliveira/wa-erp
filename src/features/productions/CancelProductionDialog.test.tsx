import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelProduction } from "@/features/productions/actions";
import { CancelProductionDialog } from "@/features/productions/CancelProductionDialog";
import { renderWithProviders } from "@/tests/render";
import { aProduction } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({ cancelProduction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ID = aProduction().id;

async function openDialog(hasFinishedItems = false, concludesBatches = false, releasesPreWeighings = true) {
  renderWithProviders(
    <CancelProductionDialog
      productionId={ID}
      hasFinishedItems={hasFinishedItems}
      concludesBatches={concludesBatches}
      releasesPreWeighings={releasesPreWeighings}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancelar produção" }));

  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  vi.mocked(cancelProduction).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe("CancelProductionDialog", () => {
  it("warns what canceling does before doing it", async () => {
    const dialog = await openDialog();

    expect(dialog).toHaveTextContent("As pré-pesagens usadas voltam a ficar disponíveis. O estoque não é alterado.");
    expect(cancelProduction).not.toHaveBeenCalled();
  });

  it("says finished items stay in the stock when some were finished", async () => {
    const dialog = await openDialog(true);

    expect(dialog).toHaveTextContent(
      "Os itens já finalizados continuam no estoque. As pré-pesagens dos demais voltam a ficar pendentes.",
    );
  });

  it("says the items with levas are concluded with what was made, moving the stock", async () => {
    const dialog = await openDialog(true, true);

    expect(dialog).toHaveTextContent(
      "Os itens com levas registradas são concluídos com o que foi feito: os ingredientes saem do estoque e os lotes entram. As pré-pesagens dos demais voltam a ficar pendentes.",
    );
    expect(dialog).not.toHaveTextContent("O estoque não é alterado.");
  });

  it("says every consequence when items were finished, have levas and have neither", async () => {
    const dialog = await openDialog(true, true, true);

    expect(dialog).toHaveTextContent(
      "Os itens já finalizados continuam no estoque. Os itens com levas registradas são concluídos com o que foi feito: os ingredientes saem do estoque e os lotes entram. As pré-pesagens dos demais voltam a ficar pendentes.",
    );
  });

  it("says nothing of pre-weighings let go when every pending item has levas", async () => {
    const dialog = await openDialog(false, true, false);

    expect(dialog).toHaveTextContent(
      "Os itens com levas registradas são concluídos com o que foi feito: os ingredientes saem do estoque e os lotes entram.",
    );
    expect(dialog).not.toHaveTextContent("voltam a ficar pendentes");
  });

  it("cancels after confirmation", async () => {
    vi.mocked(cancelProduction).mockResolvedValue({ ok: true, data: aProduction({ status: "CANCELED" }) });
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));

    await waitFor(() => expect(cancelProduction).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("does nothing when the operator goes back", async () => {
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(cancelProduction).not.toHaveBeenCalled();
  });

  // The refresh that follows takes the dialog off the page with the production closed, so the
  // explanation must outlive the dialog.
  it("explains a production already closed in a message that outlives the dialog", async () => {
    vi.mocked(cancelProduction).mockResolvedValue({ ok: false, status: 409, message: "Not in progress." });
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("A produção já foi finalizada ou cancelada. A página foi atualizada."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
