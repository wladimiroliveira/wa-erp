import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishProduction, previewLeftovers } from "@/features/productions/actions";
import { FinishProductionForm } from "@/features/productions/FinishProductionForm";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aProduction } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({ finishProduction: vi.fn(), previewLeftovers: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PRODUCTION = aProduction();
const ITEM = PRODUCTION.items[0]!;

function open() {
  return renderWithProviders(<FinishProductionForm production={PRODUCTION} />, {
    user: aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] }),
  });
}

const finish = () => userEvent.click(screen.getByRole("button", { name: "Finalizar produção" }));

const NO_LEFTOVERS = { ok: true as const, data: { items: [], totalCost: "0.00" } };

beforeEach(() => {
  vi.mocked(previewLeftovers).mockReset().mockResolvedValue(NO_LEFTOVERS);
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
        hasLeftoversInCost: true,
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
        hasLeftoversInCost: true,
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

describe("FinishProductionForm, leftovers of opened packagings", () => {
  const MILK = { sku: "018f0000-0000-7000-8000-000000000024", description: "Leite condensado", unit: "GRAM" as const };
  const WITH_LEFTOVERS = {
    ok: true as const,
    data: {
      items: [
        {
          itemId: ITEM.id,
          leftovers: [
            {
              product: MILK,
              lotId: "018f0000-0000-7000-8000-000000000060",
              quantity: "95",
              unitCost: "0.02",
              cost: "1.90",
            },
          ],
        },
      ],
      totalCost: "1.90",
    },
  };

  const section = () => screen.getByRole("region", { name: "Sobras que serão descartadas" });

  it("tells what will be discarded and puts it into the cost unless unchecked", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue(WITH_LEFTOVERS);
    vi.mocked(finishProduction).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    expect(await screen.findByText("Leite condensado: 95 g (R$ 1,90)")).toBeInTheDocument();
    expect(section()).toHaveTextContent("Total: R$ 1,90");
    const inCost = screen.getByRole("checkbox", { name: "Incluir as sobras no custo da produção" });
    expect(inCost).toBeChecked();

    await userEvent.click(inCost);
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await finish();

    await waitFor(() =>
      expect(finishProduction).toHaveBeenCalledWith(
        PRODUCTION.id,
        expect.objectContaining({ hasLeftoversInCost: false }),
      ),
    );
  });

  it("shows nothing about leftovers when there are none", async () => {
    open();

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledWith(PRODUCTION.id));
    expect(screen.queryByRole("region", { name: "Sobras que serão descartadas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Incluir as sobras no custo da produção" })).not.toBeInTheDocument();
  });

  it("still finishes when the leftovers could not be worked out", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue({ ok: false, status: 403, message: "Permission denied." });
    vi.mocked(finishProduction).mockResolvedValue({ ok: true, data: aProduction({ status: "FINISHED" }) });
    open();

    expect(await screen.findByText("Não foi possível calcular as sobras.")).toBeInTheDocument();
    // Whatever the server finds is still the user's to keep out of the cost.
    await userEvent.click(screen.getByRole("checkbox", { name: "Incluir as sobras no custo da produção" }));
    await userEvent.type(screen.getByLabelText("Produzido de Pão francês"), "10");
    await finish();

    await waitFor(() =>
      expect(finishProduction).toHaveBeenCalledWith(
        PRODUCTION.id,
        expect.objectContaining({ hasLeftoversInCost: false }),
      ),
    );
  });
});

describe("FinishProductionForm, while the leftovers are worked out", () => {
  const MILK = { sku: "018f0000-0000-7000-8000-000000000024", description: "Leite condensado", unit: "GRAM" as const };
  const lotOf = (lotId: string) => ({ product: MILK, lotId, quantity: "0.25", unitCost: "0.02", cost: "0.01" });

  it("does not finish until the leftovers are known, and says it is working them out", async () => {
    vi.mocked(previewLeftovers).mockReturnValue(new Promise(() => undefined));
    open();

    expect(screen.getByRole("status")).toHaveTextContent("Calculando as sobras…");
    expect(screen.getByRole("button", { name: "Finalizar produção" })).toBeDisabled();
  });

  it("announces the leftovers once they arrive", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            itemId: ITEM.id,
            leftovers: [{ ...lotOf("018f0000-0000-7000-8000-000000000060"), quantity: "95", cost: "1.90" }],
          },
        ],
        totalCost: "1.90",
      },
    });
    open();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Leite condensado: 95 g (R$ 1,90)"));
    expect(screen.getByRole("button", { name: "Finalizar produção" })).toBeEnabled();
  });

  it("prices a line of several lots the way the total is priced, rounding once", async () => {
    vi.mocked(previewLeftovers).mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            itemId: ITEM.id,
            leftovers: [lotOf("018f0000-0000-7000-8000-000000000060"), lotOf("018f0000-0000-7000-8000-000000000061")],
          },
        ],
        totalCost: "0.01",
      },
    });
    open();

    expect(await screen.findByText("Leite condensado: 0,5 g (R$ 0,01)")).toBeInTheDocument();
    expect(screen.getByText("Total: R$ 0,01")).toBeInTheDocument();
  });

  it("works the leftovers out again when the page brings the production anew", async () => {
    const { rerender } = open();

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledTimes(1));
    rerender(<FinishProductionForm production={{ ...PRODUCTION }} />);

    await waitFor(() => expect(previewLeftovers).toHaveBeenCalledTimes(2));
  });
});
