import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreWeighingDetailPage } from "@/features/pre-weighings/PreWeighingDetailPage";
import type { PreWeighing } from "@/lib/api";
import { renderWithProviders, type RenderOptions } from "@/tests/render";
import { columnHeaders } from "@/tests/table-layouts";
import { aCurrentUser, aPreWeighing } from "@/tests/samples";

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

  it("shows a small ingredient in the unit its plan reads best in, with at most 3 places", () => {
    open(
      aPreWeighing({
        items: [
          {
            product: { sku: "sku-3", description: "Fermento", unit: "KILOGRAM" },
            plannedQuantity: "0.0123456",
            weighedQuantity: "0.0125",
          },
        ],
      }),
    );

    const [, yeast] = screen.getAllByRole("row");
    expect(within(yeast!).getByText("12,346 g")).toBeInTheDocument();
    expect(within(yeast!).getByText("12,5 g")).toBeInTheDocument();
  });

  it("says an ingredient not weighed comes from the stock", () => {
    open(
      aPreWeighing({
        items: [
          {
            product: { sku: "sku-4", description: "Massa base", unit: "KILOGRAM" },
            plannedQuantity: "2",
            weighedQuantity: null,
          },
        ],
      }),
    );

    const [, base] = screen.getAllByRole("row");
    expect(within(base!).getByText("do estoque")).toBeInTheDocument();
  });

  it("links to the pre-weighing this one is made for", () => {
    open(
      aPreWeighing({ parent: { id: "pre-weighing-9", product: { sku: "sku-9", description: "Bolo", unit: "UNIT" } } }),
    );

    expect(screen.getByRole("link", { name: "Para: Bolo" })).toHaveAttribute("href", "/pre-weighings/pre-weighing-9");
  });

  it("lists the intermediates made in this pre-weighing, each linking to its own", () => {
    open(
      aPreWeighing({
        children: [
          {
            id: "pre-weighing-5",
            product: { sku: "sku-5", description: "Massa base", unit: "KILOGRAM" },
            quantity: "2.5",
          },
        ],
      }),
    );

    const list = within(screen.getByRole("region", { name: "Intermediários" }));
    const link = list.getByRole("link", { name: /Massa base/ });
    expect(link).toHaveAttribute("href", "/pre-weighings/pre-weighing-5");
    expect(link).toHaveTextContent("2,5 kg");
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

describe("PreWeighingDetailPage, deleting", () => {
  const CAN_CREATE = aCurrentUser({ permissions: ["PRODUCTION_READ", "PRODUCTION_CREATE"] });

  it("offers to delete a pre-weighing no production is using", () => {
    open(aPreWeighing({ isAvailable: true }), { user: CAN_CREATE });

    expect(screen.getByRole("button", { name: "Excluir pré-pesagem" })).toBeInTheDocument();
  });

  it("does not offer to delete a pre-weighing a production is using", () => {
    open(aPreWeighing({ isAvailable: false }), { user: CAN_CREATE });

    expect(screen.queryByRole("button", { name: "Excluir pré-pesagem" })).not.toBeInTheDocument();
  });

  it("does not offer to delete to someone who cannot record productions", () => {
    open(aPreWeighing({ isAvailable: true }), { user: aCurrentUser({ permissions: ["PRODUCTION_READ"] }) });

    expect(screen.queryByRole("button", { name: "Excluir pré-pesagem" })).not.toBeInTheDocument();
  });
});
