import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishProduction } from "@/features/productions/actions";
import { FinishProductionForm } from "@/features/productions/FinishProductionForm";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aProduction } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({ finishProduction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PRODUCTION = aProduction();
const ITEM = PRODUCTION.items[0]!;

function open() {
  return renderWithProviders(<FinishProductionForm production={PRODUCTION} />, {
    user: aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] }),
  });
}

const finish = () => userEvent.click(screen.getByRole("button", { name: "Finalizar produção" }));

beforeEach(() => {
  vi.mocked(finishProduction).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe("FinishProductionForm", () => {
  it("finishes with what each item produced and its expiry", async () => {
    vi.mocked(finishProduction).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "9,5");
    await userEvent.type(screen.getByLabelText("Validade de Pão francês"), "2099-01-31");
    await finish();

    await waitFor(() =>
      expect(finishProduction).toHaveBeenCalledWith(PRODUCTION.id, {
        items: [{ id: ITEM.id, producedQuantity: "9.5", expiresAt: "2099-01-31" }],
      }),
    );
  });

  it("sends no expiry when none is given", async () => {
    vi.mocked(finishProduction).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await finish();

    await waitFor(() =>
      expect(finishProduction).toHaveBeenCalledWith(PRODUCTION.id, {
        items: [{ id: ITEM.id, producedQuantity: "10", expiresAt: null }],
      }),
    );
  });

  it("refuses a blank produced quantity without calling the server", async () => {
    open();

    await finish();

    expect(await screen.findByText("Informe o produzido, com até 6 casas decimais.")).toBeInTheDocument();
    expect(finishProduction).not.toHaveBeenCalled();
  });

  it("refuses an expiry in the past without calling the server", async () => {
    open();

    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await userEvent.type(screen.getByLabelText("Validade de Pão francês"), "2020-01-01");
    await finish();

    expect(await screen.findByText("A validade não pode estar no passado.")).toBeInTheDocument();
    expect(finishProduction).not.toHaveBeenCalled();
  });

  // The refresh that follows shows the production closed and takes this form off the page, so the
  // explanation must outlive the form.
  it("explains a production finished or canceled meanwhile in a message that outlives the form", async () => {
    vi.mocked(finishProduction).mockResolvedValue({ ok: false, status: 409, message: "Not in progress." });
    const { unmount } = open();

    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await finish();
    unmount();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "A produção já foi finalizada ou cancelada, ou o custo ficou fora do limite. A página foi atualizada.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
