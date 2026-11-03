import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("is as tall as a button", () => {
    render(<Input aria-label="Buscar" />);

    expect(screen.getByRole("textbox")).toHaveClass("h-8");
  });
});
