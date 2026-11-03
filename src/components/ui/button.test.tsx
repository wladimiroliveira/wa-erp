import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("is as tall as a field by default", () => {
    render(<Button>Salvar</Button>);

    expect(screen.getByRole("button")).toHaveClass("h-8");
  });

  it("is a square as tall as a field when it only shows an icon", () => {
    render(<Button size="icon" aria-label="Fechar" />);

    expect(screen.getByRole("button")).toHaveClass("size-8");
  });
});
