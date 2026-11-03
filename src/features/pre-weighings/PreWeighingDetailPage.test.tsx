import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreWeighingDetailPage } from "@/features/pre-weighings/PreWeighingDetailPage";
import type { PreWeighing } from "@/lib/api";
import { renderWithProviders, type RenderOptions } from "@/tests/render";
import { columnHeaders } from "@/tests/table-layouts";
import { aPreWeighing } from "@/tests/samples";

const open = (preWeighing: PreWeighing = aPreWeighing(), options: RenderOptions = {}) =>
  renderWithProviders(<PreWeighingDetailPage preWeighing={preWeighing} />, {
    route: "/pre-weighings/pre-weighing-1",
    params: { id: "pre-weighing-1" },
    ...options,
  });

describe("PreWeighingDetailPage", () => {
  it("shows what was to be produced, when it was weighed and each ingredient planned against weighed", () => {
    open(
      aPreWeighing({
        quantity: "10.5",
        createdAt: "2026-10-02T12:00:00.000Z",
        items: [
          {
            product: { sku: "sku-1", description: "Farinha de trigo", unit: "KILOGRAM" },
            plannedQuantity: "6",
            weighedQuantity: "6.05",
          },
          {
            product: { sku: "sku-2", description: "Sal", unit: "GRAM" },
            plannedQuantity: "120",
            weighedQuantity: "118.5",
          },
        ],
      }),
    );

    expect(screen.getByRole("heading", { name: "Pré-pesagem de Pão francês" })).toBeInTheDocument();

    const summary = within(screen.getByRole("group", { name: "Resumo da pré-pesagem" }));
    expect(summary.getByText("10,5 kg")).toBeInTheDocument();
    expect(summary.getByText(/^02\/10\/2026/)).toBeInTheDocument();

    const [, flour, salt] = screen.getAllByRole("row");
    expect(within(flour!).getByText("Farinha de trigo")).toBeInTheDocument();
    expect(within(flour!).getByText("6 kg")).toBeInTheDocument();
    expect(within(flour!).getByText("6,05 kg")).toBeInTheDocument();
    expect(within(salt!).getByText("120 g")).toBeInTheDocument();
    expect(within(salt!).getByText("118,5 g")).toBeInTheDocument();
  });

  it("leads back to the list", () => {
    open();

    expect(screen.getByRole("link", { name: "Voltar para as pré-pesagens" })).toHaveAttribute("href", "/pre-weighings");
  });
});

describe("PreWeighingDetailPage columns", () => {
  it("shows the columns in the order the user arranged them", async () => {
    open(aPreWeighing(), {
      tableLayouts: [{ tableKey: "pre-weighing-items", order: ["planned", "ingredient"], widths: {} }],
    });

    await waitFor(() => expect(columnHeaders()[0]).toBe("Planejado"));
  });
});

describe("PreWeighingDetailPage sizing", () => {
  it("keeps the way back as tall as a control", () => {
    open();

    expect(screen.getByRole("link", { name: "Voltar para as pré-pesagens" })).toHaveClass("min-h-8");
  });
});
