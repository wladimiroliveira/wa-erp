import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";

describe("Checkbox", () => {
  it("answers a tap as far out as a 32px control, no further", () => {
    render(<Checkbox aria-label="Ativo" />);

    expect(screen.getByRole("checkbox")).toHaveClass("after:-inset-2");
  });
});
