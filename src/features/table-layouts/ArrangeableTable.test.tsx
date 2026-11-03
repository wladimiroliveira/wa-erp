import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTableLayout, saveTableLayout } from "@/features/table-layouts/actions";
import { ArrangeableTable, type Column } from "@/features/table-layouts/ArrangeableTable";
import type { TableLayout } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";

vi.mock("@/features/table-layouts/actions", () => ({
  saveTableLayout: vi.fn(async () => ({ ok: true })),
  resetTableLayout: vi.fn(async () => ({ ok: true })),
}));

type Fruit = { id: string; name: string; color: string; price: string };

const FRUITS: Fruit[] = [{ id: "1", name: "Maçã", color: "Vermelha", price: "3,50" }];

const COLUMNS: Column<Fruit>[] = [
  { key: "name", header: "Nome", cell: (fruit) => fruit.name },
  { key: "color", header: "Cor", cell: (fruit) => fruit.color },
  { key: "price", header: "Preço", cell: (fruit) => fruit.price },
  { key: "actions", header: "Ações", cell: (fruit) => `Ações de ${fruit.name}` },
];

/** What the server layout handed over for this session. */
let layouts: TableLayout[] = [];

function savedLayouts(saved: TableLayout[]) {
  layouts = saved;
}

/** Records every layout the table sends for "fruits". */
function recordSaves(): unknown[] {
  const saves: unknown[] = [];

  vi.mocked(saveTableLayout).mockImplementation(async (_tableKey, body) => {
    saves.push(body);
    return { ok: true };
  });

  return saves;
}

function renderFruits(columns: Column<Fruit>[] = COLUMNS) {
  return renderWithProviders(
    <ArrangeableTable
      tableKey="fruits"
      columns={columns}
      rows={FRUITS}
      rowKey={(fruit) => fruit.id}
      rowNoun={{ one: "fruta", other: "frutas" }}
    />,
    { tableLayouts: layouts },
  );
}

const headers = () => screen.getAllByRole("columnheader").map((header) => header.textContent);

beforeEach(() => {
  layouts = [];
  vi.mocked(saveTableLayout).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(resetTableLayout).mockReset().mockResolvedValue({ ok: true });
});

describe("ArrangeableTable", () => {
  it("shows the columns as designed when the user never arranged them", async () => {
    savedLayouts([]);

    renderFruits();

    expect(await screen.findByRole("cell", { name: "Maçã" })).toBeInTheDocument();
    expect(headers()).toEqual(["Nome", "Cor", "Preço", "Ações"]);
  });

  it("shows the columns in the order the user saved, wherever they saved it", async () => {
    savedLayouts([{ tableKey: "fruits", order: ["price", "name", "color", "actions"], widths: {} }]);

    renderFruits();

    await waitFor(() => expect(headers()).toEqual(["Preço", "Nome", "Cor", "Ações"]));
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "3,50",
      "Maçã",
      "Vermelha",
      "Ações de Maçã",
    ]);
  });

  it("gives each column the width the user saved", async () => {
    savedLayouts([{ tableKey: "fruits", order: [], widths: { name: 300, color: 90, price: 120, actions: 64 } }]);

    renderFruits();

    await waitFor(() => expect(screen.getByRole("columnheader", { name: /Nome/ })).toHaveStyle({ width: "300px" }));
    expect(screen.getByRole("table")).toHaveStyle({ tableLayout: "fixed", width: "574px" });
  });

  it("never leaves a gap beside the table: the last column takes whatever room is left", async () => {
    savedLayouts([{ tableKey: "fruits", order: [], widths: { name: 300, color: 90, price: 120, actions: 64 } }]);

    renderFruits();

    await waitFor(() => expect(screen.getByRole("table")).toHaveStyle({ minWidth: "100%" }));
    // Under a fixed layout, the one column with no width is the one that grows into the space left.
    expect(screen.getByRole("columnheader", { name: "Ações" }).style.width).toBe("");
    expect(screen.getByRole("columnheader", { name: "Cor" })).toHaveStyle({ width: "90px" });
    expect(screen.getByRole("columnheader", { name: "Preço" })).toHaveStyle({ width: "120px" });
  });

  it("moves a column from the keyboard and saves the new order", async () => {
    savedLayouts([]);
    const saves = recordSaves();
    renderFruits();

    await screen.findByRole("cell", { name: "Maçã" });
    screen.getByRole("button", { name: "Mover coluna Preço" }).focus();
    await userEvent.keyboard("{ArrowLeft}");

    expect(headers()).toEqual(["Nome", "Preço", "Cor", "Ações"]);
    // Focus stays on the column moved, so it can keep going.
    expect(screen.getByRole("button", { name: "Mover coluna Preço" })).toHaveFocus();
    await waitFor(() => expect(saves).toEqual([{ order: ["name", "price", "color", "actions"], widths: {} }]));
  });

  it("widens a column from the keyboard at the expense of its neighbour, and saves the width of every column", async () => {
    savedLayouts([{ tableKey: "fruits", order: [], widths: { name: 200, color: 100, price: 100, actions: 64 } }]);
    const saves = recordSaves();
    renderFruits();

    const handle = await screen.findByRole("separator", { name: "Redimensionar coluna Nome" });
    await waitFor(() => expect(handle).toHaveAttribute("aria-valuenow", "200"));
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(screen.getByRole("columnheader", { name: /Nome/ })).toHaveStyle({ width: "216px" });
    expect(screen.getByRole("columnheader", { name: "Cor" })).toHaveStyle({ width: "84px" });
    await waitFor(() =>
      expect(saves).toEqual([{ order: [], widths: { name: 216, color: 84, price: 100, actions: 64 } }]),
    );
  });

  it("names each header by its title alone, apart from the controls inside it", async () => {
    savedLayouts([]);

    renderFruits();

    expect(await screen.findByRole("columnheader", { name: "Nome" })).toBeInTheDocument();
  });

  it("widens the first column from its left side, moving no border but the outer one", async () => {
    savedLayouts([{ tableKey: "fruits", order: [], widths: { name: 200, color: 100, price: 100, actions: 64 } }]);
    const saves = recordSaves();
    renderFruits();

    const handle = await screen.findByRole("separator", { name: "Redimensionar coluna Nome pela esquerda" });
    await waitFor(() => expect(handle).toHaveAttribute("aria-valuenow", "200"));
    handle.focus();
    // The left side moves left, away from the column: it grows.
    await userEvent.keyboard("{ArrowLeft}");

    await waitFor(() =>
      expect(saves).toEqual([{ order: [], widths: { name: 216, color: 100, price: 100, actions: 64 } }]),
    );
  });

  it("offers the left side only on the first column, as every other left side is a border already offered", async () => {
    savedLayouts([]);

    renderFruits();

    await screen.findByRole("cell", { name: "Maçã" });
    expect(screen.getAllByRole("separator", { name: /pela esquerda/ })).toHaveLength(1);
  });

  it("widens the last column from its right side alone, as nothing lies past it to give room", async () => {
    savedLayouts([{ tableKey: "fruits", order: [], widths: { name: 200, color: 100, price: 100, actions: 64 } }]);
    const saves = recordSaves();
    renderFruits();

    const handle = await screen.findByRole("separator", { name: "Redimensionar coluna Ações" });
    await waitFor(() => expect(handle).toHaveAttribute("aria-valuenow", "64"));
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");

    await waitFor(() =>
      expect(saves).toEqual([{ order: [], widths: { name: 200, color: 100, price: 100, actions: 80 } }]),
    );
  });

  it("keeps the resize handles whole, instead of clipping them at the edge of the header", async () => {
    savedLayouts([{ tableKey: "fruits", order: [], widths: { name: 200, color: 100, price: 100, actions: 64 } }]);

    renderFruits();

    await waitFor(() => expect(screen.getByRole("table")).toHaveStyle({ tableLayout: "fixed" }));
    expect(screen.getByRole("columnheader", { name: "Nome" })).not.toHaveClass("overflow-hidden");
  });

  it("moves and resizes the actions column like any other", async () => {
    savedLayouts([]);
    const saves = recordSaves();
    renderFruits();

    await screen.findByRole("cell", { name: "Maçã" });
    const actions = screen.getByRole("columnheader", { name: "Ações" });
    expect(within(actions).getByRole("separator", { name: "Redimensionar coluna Ações" })).toBeInTheDocument();
    within(actions).getByRole("button", { name: "Mover coluna Ações" }).focus();
    await userEvent.keyboard("{ArrowLeft}");

    expect(headers()).toEqual(["Nome", "Cor", "Ações", "Preço"]);
    await waitFor(() => expect(saves).toEqual([{ order: ["name", "color", "actions", "price"], widths: {} }]));
  });

  it("places a column shown only to some users where it was designed", async () => {
    savedLayouts([{ tableKey: "fruits", order: ["color", "name", "actions"], widths: {} }]);

    renderFruits();

    // Preço was designed right after Cor, so that is where it goes.
    await waitFor(() => expect(headers()).toEqual(["Cor", "Preço", "Nome", "Ações"]));
  });

  it("puts the columns back as designed when asked", async () => {
    savedLayouts([{ tableKey: "fruits", order: ["price", "name", "color", "actions"], widths: { name: 300 } }]);
    renderFruits();

    await userEvent.click(await screen.findByRole("button", { name: "Restaurar colunas" }));

    expect(headers()).toEqual(["Nome", "Cor", "Preço", "Ações"]);
    expect(screen.getByRole("table")).not.toHaveStyle({ tableLayout: "fixed" });
    expect(screen.queryByRole("button", { name: "Restaurar colunas" })).not.toBeInTheDocument();
    await waitFor(() => expect(resetTableLayout).toHaveBeenCalledWith("fruits"));
  });

  it("counts its rows with the noun it is given", async () => {
    savedLayouts([]);

    renderWithProviders(
      <ArrangeableTable
        tableKey="fruits"
        columns={COLUMNS}
        rows={[...FRUITS, { id: "2", name: "Pera", color: "Verde", price: "4,00" }]}
        rowKey={(fruit) => fruit.id}
        rowNoun={{ one: "fruta", other: "frutas" }}
      />,
    );

    expect(await screen.findByText("2 frutas")).toBeInTheDocument();
  });

  it("counts a single row in the singular", async () => {
    savedLayouts([]);

    renderFruits();

    expect(await screen.findByText("1 fruta")).toBeInTheDocument();
  });

  it("puts the columns back with an icon button beside the count, explained on hover", async () => {
    savedLayouts([{ tableKey: "fruits", order: ["price", "name", "color", "actions"], widths: {} }]);

    renderFruits();

    const restore = await screen.findByRole("button", { name: "Restaurar colunas" });
    expect(restore).toHaveTextContent("");
    expect(restore.querySelector("svg")).not.toBeNull();
    expect(restore.parentElement).toContainElement(screen.getByText("1 fruta"));

    await userEvent.hover(restore);

    expect(await screen.findByText("Restaurar a ordem e a largura originais das colunas")).toBeInTheDocument();
  });

  it("shows the actions it is given in the row of the count", async () => {
    savedLayouts([]);

    renderWithProviders(
      <ArrangeableTable
        tableKey="fruits"
        columns={COLUMNS}
        rows={FRUITS}
        rowKey={(fruit) => fruit.id}
        rowNoun={{ one: "fruta", other: "frutas" }}
        actions={<button type="button">Nova fruta</button>}
      />,
    );

    const action = await screen.findByRole("button", { name: "Nova fruta" });
    expect(action.closest("div")).toContainElement(screen.getByText("1 fruta"));
  });

  it("offers no way back when nothing was arranged", async () => {
    savedLayouts([]);

    renderFruits();

    await screen.findByRole("cell", { name: "Maçã" });
    expect(screen.queryByRole("button", { name: "Restaurar colunas" })).not.toBeInTheDocument();
  });

  it("goes back to what the server holds when a change fails to save", async () => {
    savedLayouts([]);
    vi.mocked(saveTableLayout).mockResolvedValue({ ok: false, status: 400, message: "Invalid input." });
    renderFruits();

    await screen.findByRole("cell", { name: "Maçã" });
    screen.getByRole("button", { name: "Mover coluna Preço" }).focus();
    await userEvent.keyboard("{ArrowLeft}");

    await waitFor(() => expect(headers()).toEqual(["Nome", "Cor", "Preço", "Ações"]));
  });
});
