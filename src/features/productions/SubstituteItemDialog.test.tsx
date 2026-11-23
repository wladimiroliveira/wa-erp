import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewSubstitution, substituteProductionItem } from "@/features/productions/actions";
import { SubstituteItemDialog } from "@/features/productions/SubstituteItemDialog";
import { renderWithProviders } from "@/tests/render";
import { aProduction, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({
  previewSubstitution: vi.fn(),
  substituteProductionItem: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const production = aProduction();
const item = aProductionItem();
const preview = (available: string, needed: string) => ({
  ok: true as const,
  data: { product: item.product, available, needed },
});

async function openDialog(available = "8", needed = "5") {
  vi.mocked(previewSubstitution).mockResolvedValue(preview(available, needed));
  renderWithProviders(<SubstituteItemDialog productionId={production.id} item={item} />);
  await userEvent.click(screen.getByRole("button", { name: "Usar do estoque" }));

  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  vi.mocked(previewSubstitution).mockReset();
  vi.mocked(substituteProductionItem).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe("SubstituteItemDialog", () => {
  it("shows the stock against what is needed when it opens", async () => {
    const dialog = await openDialog();

    expect(await screen.findByText(/No estoque: .*8.* · necessário: .*5/)).toBeInTheDocument();
    expect(previewSubstitution).toHaveBeenCalledWith(production.id, item.id);
    expect(dialog).not.toHaveTextContent("O estoque não cobre o necessário.");
  });

  it("warns when the stock does not cover what is needed", async () => {
    await openDialog("2", "5");

    expect(await screen.findByText("O estoque não cobre o necessário.")).toHaveClass("text-destructive");
  });

  it("uses the stock after confirmation", async () => {
    vi.mocked(substituteProductionItem).mockResolvedValue({ ok: true, data: production });
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(substituteProductionItem).toHaveBeenCalledWith(production.id, item.id));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("does nothing when the operator goes back", async () => {
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(substituteProductionItem).not.toHaveBeenCalled();
  });

  it("explains a conflict in a toast and closes", async () => {
    vi.mocked(substituteProductionItem).mockResolvedValue({ ok: false, status: 409, message: "changed" });
    await openDialog();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("O item mudou enquanto isso. A página foi atualizada."),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});
