import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/common/EmptyState";

describe("EmptyState", () => {
  it("says why the list is empty and offers the way forward under it", () => {
    render(<EmptyState actions={<button type="button">Novo produto</button>}>Nenhum produto ativo.</EmptyState>);

    expect(screen.getByText("Nenhum produto ativo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo produto" })).toBeInTheDocument();
  });

  it("shows only the message when there is nothing to offer", () => {
    render(<EmptyState actions={null}>Nenhum produto ativo.</EmptyState>);

    expect(screen.getByText("Nenhum produto ativo.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
