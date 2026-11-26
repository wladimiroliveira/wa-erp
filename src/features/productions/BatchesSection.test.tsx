import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordBatch, removeBatch } from "@/features/productions/actions";
import { BatchesSection } from "@/features/productions/BatchesSection";
import type { ProductionItem } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aProduction, aProductionBatch, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({
  recordBatch: vi.fn(),
  removeBatch: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const USER = aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] });
const BOMBOM = { sku: "sku-bombom", description: "Bombom", unit: "UNIT" as const };
const FIRST_AT = "2026-10-14T12:10:00.000Z";
const SECOND_AT = "2026-10-14T12:40:00.000Z";

const bombom = (over: Partial<ProductionItem> = {}) =>
  aProductionItem({
    id: "item-bombom",
    product: BOMBOM,
    expectedQuantity: "50",
    batches: [
      aProductionBatch({ id: "batch-1", quantity: "20", expiresAt: "2099-01-31", createdAt: FIRST_AT }),
      aProductionBatch({ id: "batch-2", quantity: "15", source: "EXISTING", createdAt: SECOND_AT }),
    ],
    ...over,
  });

function open(item: ProductionItem = bombom(), canRecord = true) {
  const production = aProduction({ id: "prod-1", items: [item] });

  return renderWithProviders(<BatchesSection production={production} item={item} canRecord={canRecord} />, {
    user: USER,
  });
}

beforeEach(() => {
  vi.mocked(recordBatch).mockReset().mockResolvedValue({ ok: true, data: aProduction() });
  vi.mocked(removeBatch).mockReset().mockResolvedValue({ ok: true, data: aProduction() });
  vi.mocked(toast.error).mockReset();
});

describe("BatchesSection, progress", () => {
  it("says how much was made of the target and what is missing, with a bar", () => {
    open();

    expect(screen.getByText("35 un de 50 un · faltam 15 un")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Progresso de Bombom" });
    expect(bar).toHaveAttribute("aria-valuenow", "35");
    expect(bar).toHaveAttribute("aria-valuemax", "50");
  });

  it("says the target was reached", () => {
    open(bombom({ batches: [aProductionBatch({ quantity: "50" })] }));

    expect(screen.getByText("50 un de 50 un · meta atingida")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progresso de Bombom" })).toHaveAttribute("aria-valuenow", "50");
  });
});

describe("BatchesSection, levas", () => {
  const row = (at: string) =>
    within(screen.getByRole("button", { name: `Remover leva de ${formatDateTime(at)}` }).closest("li")!);

  it("lists each leva with its time, quantity and expiry, marking what already existed", () => {
    open();

    const first = row(FIRST_AT);
    expect(first.getByText(formatDateTime(FIRST_AT))).toBeInTheDocument();
    expect(first.getByText("20 un")).toBeInTheDocument();
    expect(first.getByText("31/01/2099")).toBeInTheDocument();
    expect(first.queryByText("já existia")).not.toBeInTheDocument();

    const second = row(SECOND_AT);
    expect(second.getByText("15 un")).toBeInTheDocument();
    expect(second.getByText("sem validade")).toBeInTheDocument();
    expect(second.getByText("já existia")).toBeInTheDocument();
  });

  it("removes a leva", async () => {
    open();

    await userEvent.click(screen.getByRole("button", { name: `Remover leva de ${formatDateTime(SECOND_AT)}` }));

    await waitFor(() => expect(removeBatch).toHaveBeenCalledWith("prod-1", "item-bombom", "batch-2"));
  });

  it("explains a change made meanwhile and refreshes", async () => {
    vi.mocked(removeBatch).mockResolvedValue({ ok: false, status: 409, message: "Not pending." });
    open();

    await userEvent.click(screen.getByRole("button", { name: `Remover leva de ${formatDateTime(FIRST_AT)}` }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Um item mudou enquanto isso. A página foi atualizada."),
    );
  });

  it("shows the levas but offers no way to change them to whoever may only read", () => {
    open(bombom(), false);

    expect(screen.getByText("20 un")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remover leva/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar leva" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lançar do que já existe" })).not.toBeInTheDocument();
  });
});

describe("BatchesSection, registering a leva", () => {
  const quantity = () => screen.getByLabelText("Quantidade da leva de Bombom");
  const expiry = () => screen.getByLabelText("Validade da leva de Bombom");

  it("fills its fields with the page's background, so they stand out on a highlighted card", () => {
    open();

    expect(quantity()).toHaveClass("bg-background");
    expect(expiry()).toHaveClass("bg-background");
    expect(screen.getByText("Quantidade")).toBeInTheDocument();
    expect(screen.getByText("Validade (opcional)")).toBeInTheDocument();
  });

  it("sends what came out of the leva and when it expires", async () => {
    open();

    await userEvent.type(quantity(), "12,5");
    await userEvent.type(expiry(), "2099-02-28");
    await userEvent.click(screen.getByRole("button", { name: "Registrar leva" }));

    await waitFor(() =>
      expect(recordBatch).toHaveBeenCalledWith("prod-1", "item-bombom", {
        quantity: "12.5",
        expiresAt: "2099-02-28",
        source: "PRODUCED",
      }),
    );
    await waitFor(() => expect(quantity()).toHaveValue(""));
  });

  it("sends a leva without an expiry as one that does not expire", async () => {
    open();

    await userEvent.type(quantity(), "10");
    await userEvent.click(screen.getByRole("button", { name: "Registrar leva" }));

    await waitFor(() =>
      expect(recordBatch).toHaveBeenCalledWith("prod-1", "item-bombom", {
        quantity: "10",
        expiresAt: null,
        source: "PRODUCED",
      }),
    );
  });

  it("refuses a blank quantity without calling the server", async () => {
    open();

    await userEvent.click(screen.getByRole("button", { name: "Registrar leva" }));

    expect(await screen.findByText("Informe a quantidade, com até 6 casas decimais.")).toBeInTheDocument();
    expect(recordBatch).not.toHaveBeenCalled();
  });

  it("refuses an expiry in the past without calling the server", async () => {
    open();

    await userEvent.type(quantity(), "10");
    await userEvent.type(expiry(), "2020-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Registrar leva" }));

    expect(await screen.findByText("A validade não pode estar no passado.")).toBeInTheDocument();
    expect(recordBatch).not.toHaveBeenCalled();
  });

  it("launches what already existed as a leva of existing stock", async () => {
    open();

    expect(screen.queryByRole("button", { name: "Lançar" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Lançar do que já existe" }));
    await userEvent.type(quantity(), "5");
    await userEvent.click(screen.getByRole("button", { name: "Lançar" }));

    await waitFor(() =>
      expect(recordBatch).toHaveBeenCalledWith("prod-1", "item-bombom", {
        quantity: "5",
        expiresAt: null,
        source: "EXISTING",
      }),
    );
  });

  it("explains a change made meanwhile and refreshes", async () => {
    vi.mocked(recordBatch).mockResolvedValue({ ok: false, status: 409, message: "Not pending." });
    open();

    await userEvent.type(quantity(), "10");
    await userEvent.click(screen.getByRole("button", { name: "Registrar leva" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Um item mudou enquanto isso. A página foi atualizada."),
    );
  });
});
