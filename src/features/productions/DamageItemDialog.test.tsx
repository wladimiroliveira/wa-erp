import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { damageProductionItem } from "@/features/productions/actions";
import { DamageItemDialog } from "@/features/productions/DamageItemDialog";
import { renderWithProviders } from "@/tests/render";
import { aLossReason, aProduction, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({ damageProductionItem: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const production = aProduction();
const item = aProductionItem();
const REASONS = [
  aLossReason({ id: "018f0000-0000-7000-8000-000000000071", name: "Queimou" }),
  aLossReason({ id: "018f0000-0000-7000-8000-000000000072", name: "Caiu no chão" }),
];

async function openDialog(lossReasons = REASONS) {
  renderWithProviders(<DamageItemDialog productionId={production.id} item={item} lossReasons={lossReasons} />);
  await userEvent.click(screen.getByRole("button", { name: "Registrar avaria" }));

  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  vi.mocked(damageProductionItem).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe("DamageItemDialog", () => {
  it("says what the damage does before doing it", async () => {
    const dialog = await openDialog();

    expect(dialog).toHaveTextContent("Registrar avaria de Pão francês?");
    expect(dialog).toHaveTextContent("Os ingredientes vão para as perdas e nada entra no estoque.");
    expect(damageProductionItem).not.toHaveBeenCalled();
  });

  it("records the damage with the chosen reason and the note", async () => {
    vi.mocked(damageProductionItem).mockResolvedValue({ ok: true, data: production });
    await openDialog();

    await userEvent.selectOptions(screen.getByLabelText("Motivo"), "Caiu no chão");
    await userEvent.type(screen.getByLabelText("Observação"), "  escorregou ");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar avaria" }));

    await waitFor(() =>
      expect(damageProductionItem).toHaveBeenCalledWith(production.id, item.id, {
        reasonId: REASONS[1]!.id,
        note: "escorregou",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("starts on a blank reason and keeps confirm disabled until one is picked", async () => {
    await openDialog();

    expect(screen.getByLabelText("Motivo")).toHaveValue("");
    expect(screen.getByRole("option", { name: "Selecione o motivo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar avaria" })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Motivo"), "Queimou");

    expect(screen.getByRole("button", { name: "Confirmar avaria" })).toBeEnabled();
  });

  it("asks for an active loss reason to be registered when there are none", async () => {
    const dialog = await openDialog([]);

    expect(dialog).toHaveTextContent("Cadastre um motivo de perda ativo para registrar a avaria.");
    expect(screen.getByRole("button", { name: "Confirmar avaria" })).toBeDisabled();
  });

  it("does nothing when the operator goes back", async () => {
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(damageProductionItem).not.toHaveBeenCalled();
  });

  it("explains a conflict in a toast and closes", async () => {
    vi.mocked(damageProductionItem).mockResolvedValue({ ok: false, status: 409, message: "changed" });
    await openDialog();
    await userEvent.selectOptions(screen.getByLabelText("Motivo"), "Queimou");

    await userEvent.click(screen.getByRole("button", { name: "Confirmar avaria" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("O item mudou enquanto isso. A página foi atualizada."),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it.each([
    [409, "Loss reason is inactive.", "Esse motivo de perda foi desativado. A página foi atualizada."],
    [404, "Loss reason not found.", "Esse motivo de perda não existe mais. A página foi atualizada."],
  ] as const)("explains a refused reason (%s) in a toast and refreshes", async (status, message, shown) => {
    vi.mocked(damageProductionItem).mockResolvedValue({ ok: false, status, message });
    await openDialog();
    await userEvent.selectOptions(screen.getByLabelText("Motivo"), "Queimou");

    await userEvent.click(screen.getByRole("button", { name: "Confirmar avaria" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(shown));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open on a missing item and says so", async () => {
    vi.mocked(damageProductionItem).mockResolvedValue({ ok: false, status: 404, message: "gone" });
    await openDialog();
    await userEvent.selectOptions(screen.getByLabelText("Motivo"), "Queimou");

    await userEvent.click(screen.getByRole("button", { name: "Confirmar avaria" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Esse item não existe mais.");
  });
});
