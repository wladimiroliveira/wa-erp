import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLossReason, updateLossReason } from "@/features/losses/actions";
import { LossReasonsPage } from "@/features/losses/LossReasonsPage";
import type { LossReason } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aLossReason } from "@/tests/samples";
import { columnHeaders } from "@/tests/table-layouts";
import { chooseRowAction } from "@/tests/row-actions";

vi.mock("@/features/losses/actions", () => ({ createLossReason: vi.fn(), updateLossReason: vi.fn() }));

const createMock = vi.mocked(createLossReason);
const updateMock = vi.mocked(updateLossReason);

const renderPage = (
  reasons: LossReason[],
  tableLayouts: { tableKey: string; order: string[]; widths: Record<string, number> }[] = [],
) => renderWithProviders(<LossReasonsPage reasons={reasons} />, { tableLayouts });

const rowOf = (name: string) => within(screen.getByRole("cell", { name }).closest("tr")!);

beforeEach(() => {
  createMock.mockReset();
  updateMock.mockReset();
});

describe("LossReasonsPage", () => {
  it("lists each reason with its description and whether it is in use", async () => {
    renderPage([
      aLossReason({ id: "reason-1", name: "Vencimento", description: "Passou da validade." }),
      aLossReason({ id: "reason-2", name: "Quebra", description: null, isActive: false }),
    ]);

    await screen.findByRole("cell", { name: "Vencimento" });
    expect(rowOf("Vencimento").getByText("Passou da validade.")).toBeInTheDocument();
    expect(rowOf("Vencimento").getByText("Ativa")).toBeInTheDocument();
    expect(rowOf("Quebra").getByText("—")).toBeInTheDocument();
    expect(rowOf("Quebra").getByText("Inativa")).toBeInTheDocument();
  });

  it("offers the registration as an icon button in the row of the count", async () => {
    renderPage([aLossReason()]);

    const create = await screen.findByRole("button", { name: "Nova modalidade" });
    expect(create).toHaveTextContent("");
    expect(create.closest("div")).toContainElement(screen.getByText("1 modalidade"));
  });

  it("still offers the registration when the list is empty", async () => {
    renderPage([]);

    await screen.findByText("Nenhuma modalidade cadastrada ainda.");
    expect(screen.getByRole("button", { name: "Nova modalidade" })).toBeInTheDocument();
  });

  it("says there are no reasons instead of showing a bare table", async () => {
    renderPage([]);

    expect(await screen.findByText("Nenhuma modalidade cadastrada ainda.")).toBeInTheDocument();
  });

  it("registers a reason with its description, closes the dialog and shows it once the list is read again", async () => {
    const created = aLossReason({ id: "reason-new", name: "Vencimento", description: "Passou da validade." });
    createMock.mockResolvedValue({ ok: true, data: created });

    const { rerender } = renderPage([]);

    await userEvent.click(await screen.findByRole("button", { name: "Nova modalidade" }));
    await userEvent.type(await screen.findByLabelText("Nome"), "Vencimento");
    await userEvent.type(screen.getByLabelText("Descrição (opcional)"), "Passou da validade.");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ name: "Vencimento", description: "Passou da validade." }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // The action revalidated the list; the server hands the screen the new one.
    rerender(<LossReasonsPage reasons={[created]} />);

    expect(await screen.findByRole("cell", { name: "Vencimento" })).toBeInTheDocument();
  });

  it("refuses a reason with no name", async () => {
    renderPage([]);

    await userEvent.click(await screen.findByRole("button", { name: "Nova modalidade" }));
    await userEvent.click(await screen.findByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Informe o nome da modalidade.")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("opens a reason already filled to edit it, and sends the change", async () => {
    const edited = aLossReason({ id: "reason-1", name: "Vencido", description: null });
    updateMock.mockResolvedValue({ ok: true, data: edited });

    const { rerender } = renderPage([aLossReason({ id: "reason-1", name: "Vencimento", description: "Antiga." })]);

    await chooseRowAction("Ações de Vencimento", "Editar");

    const name = await screen.findByLabelText("Nome", { selector: "input" });
    expect(name).toHaveValue("Vencimento");
    expect(screen.getByLabelText("Descrição (opcional)")).toHaveValue("Antiga.");

    await userEvent.clear(name);
    await userEvent.type(name, "Vencido");
    await userEvent.clear(screen.getByLabelText("Descrição (opcional)"));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("reason-1", { name: "Vencido", description: null }));

    rerender(<LossReasonsPage reasons={[edited]} />);

    expect(await screen.findByRole("cell", { name: "Vencido" })).toBeInTheDocument();
  });

  it("says the name is taken, in Portuguese, and keeps the dialog open", async () => {
    createMock.mockResolvedValue({ ok: false, status: 409, message: "Taken." });

    renderPage([]);

    await userEvent.click(await screen.findByRole("button", { name: "Nova modalidade" }));
    await userEvent.type(await screen.findByLabelText("Nome"), "Vencimento");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma modalidade com esse nome.");
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
  });

  it("deactivates a reason in use and reactivates one that is not", async () => {
    const reason = aLossReason({ id: "reason-1", name: "Vencimento" });
    updateMock.mockImplementation(async (_id, body) => ({ ok: true, data: { ...reason, ...body } as LossReason }));

    const { rerender } = renderPage([reason]);

    await chooseRowAction("Ações de Vencimento", "Inativar");
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("reason-1", { isActive: false }));

    rerender(<LossReasonsPage reasons={[{ ...reason, isActive: false }]} />);
    expect(await screen.findByText("Inativa")).toBeInTheDocument();

    await chooseRowAction("Ações de Vencimento", "Reativar");
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("reason-1", { isActive: true }));
  });
});

describe("LossReasonsPage layout", () => {
  it("gives the table the height left on the screen", async () => {
    renderPage([aLossReason({ name: "Vencimento" })]);

    await screen.findByRole("cell", { name: "Vencimento" });
    expect(screen.getByRole("table").parentElement).toHaveAttribute("data-fill", "true");
  });
});

describe("LossReasonsPage columns", () => {
  it("shows the columns in the order the user arranged them", async () => {
    renderPage([aLossReason()], [{ tableKey: "loss-reasons", order: ["description", "name"], widths: {} }]);

    await waitFor(() => expect(columnHeaders()[0]).toBe("Descrição"));
  });
});
