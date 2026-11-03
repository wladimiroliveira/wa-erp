import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotFoundPage } from "@/features/errors/NotFoundPage";
import { renderWithProviders } from "@/tests/render";

describe("NotFoundPage", () => {
  it("keeps the way back as tall as a control", () => {
    renderWithProviders(<NotFoundPage />);

    expect(screen.getByRole("link", { name: "Voltar ao início" })).toHaveClass("min-h-8");
  });
});
