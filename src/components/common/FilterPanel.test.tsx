import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterPanel } from "@/components/common/FilterPanel";

describe("FilterPanel", () => {
  it("draws a border around the filters, so their extent is plain to see", () => {
    render(
      <FilterPanel label="Filtrar produtos" onSubmit={() => {}}>
        <input aria-label="Buscar" />
      </FilterPanel>,
    );

    const panel = screen.getByRole("search", { name: "Filtrar produtos" });
    expect(panel).toHaveClass("border");
    expect(panel).toContainElement(screen.getByRole("textbox", { name: "Buscar" }));
  });

  it("runs the query only when Consultar is pressed", async () => {
    const submit = vi.fn();
    render(
      <FilterPanel label="Filtrar produtos" onSubmit={submit}>
        <input aria-label="Buscar" />
      </FilterPanel>,
    );

    await userEvent.type(screen.getByRole("textbox", { name: "Buscar" }), "pão");
    expect(submit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Consultar" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("runs the query when Enter is pressed in a field", async () => {
    const submit = vi.fn();
    render(
      <FilterPanel label="Filtrar produtos" onSubmit={submit}>
        <input aria-label="Buscar" />
      </FilterPanel>,
    );

    await userEvent.type(screen.getByRole("textbox", { name: "Buscar" }), "pão{Enter}");

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("offers to clear the filters only when given a way to", async () => {
    const clear = vi.fn();
    const { rerender } = render(<FilterPanel label="Filtrar produtos" onSubmit={() => {}} />);

    expect(screen.queryByRole("button", { name: "Limpar filtros" })).not.toBeInTheDocument();

    rerender(<FilterPanel label="Filtrar produtos" onSubmit={() => {}} onClear={clear} />);
    await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));

    expect(clear).toHaveBeenCalledTimes(1);
  });
});
