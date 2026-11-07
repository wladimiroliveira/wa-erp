import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductionDetailPage } from "@/features/productions/ProductionDetailPage";
import { moneyOf } from "@/features/stock/stock-format";
import type { Permission, Production } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aProduction, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({ finishProduction: vi.fn(), cancelProduction: vi.fn() }));

const RECORDER: Permission[] = ["PRODUCTION_READ", "PRODUCTION_CREATE"];

function open(production: Production = aProduction(), permissions: Permission[] = RECORDER) {
  return renderWithProviders(<ProductionDetailPage production={production} />, {
    user: aCurrentUser({ permissions }),
  });
}

describe("ProductionDetailPage", () => {
  it("shows each item with its origin, quantities and inputs", () => {
    open(
      aProduction({
        items: [
          aProductionItem({ id: "item-1", preWeighingId: "018f0000-0000-7000-8000-0000000000a0" }),
          aProductionItem({
            id: "item-2",
            product: { sku: "sku-2", description: "Pão de queijo", unit: "KILOGRAM" },
            expectedQuantity: "4",
          }),
        ],
      }),
    );

    const guided = screen.getByRole("region", { name: "Pão francês" });
    const free = screen.getByRole("region", { name: "Pão de queijo" });

    expect(within(guided).getByRole("link", { name: "Pré-pesagem" })).toHaveAttribute(
      "href",
      "/pre-weighings/018f0000-0000-7000-8000-0000000000a0",
    );
    expect(within(guided).getByText("10 kg")).toBeInTheDocument();
    expect(within(guided).getByRole("cell", { name: "Farinha de trigo" })).toBeInTheDocument();
    expect(within(free).getByText("Receita")).toBeInTheDocument();
    expect(within(free).getByText("4 kg")).toBeInTheDocument();
  });

  it("shows the costs of a finished production", () => {
    open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T15:00:00.000Z",
        items: [
          aProductionItem({
            producedQuantity: "9.5",
            unitCost: "2.5",
            inputs: [{ ...aProductionItem().inputs[0]!, unitCost: "1.2" }],
          }),
        ],
      }),
    );

    expect(screen.getByText("Finalizada em")).toBeInTheDocument();
    expect(screen.getByText("9,5 kg")).toBeInTheDocument();
    expect(screen.getByText(moneyOf("2.5"))).toBeInTheDocument();
    expect(screen.getByText(moneyOf("1.2"))).toBeInTheDocument();
  });

  it("offers finishing while in progress to whoever may record production", () => {
    open();

    expect(screen.getByRole("button", { name: "Finalizar produção" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar produção" })).toBeInTheDocument();
  });

  it("offers no finishing once the production is closed", () => {
    open(aProduction({ status: "CANCELED", canceledAt: "2026-10-14T15:00:00.000Z" }));

    expect(screen.getByText("Cancelada em")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finalizar produção" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar produção" })).not.toBeInTheDocument();
  });

  it("offers no finishing to whoever may only read production", () => {
    open(aProduction(), ["PRODUCTION_READ"]);

    expect(screen.queryByRole("button", { name: "Finalizar produção" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar produção" })).not.toBeInTheDocument();
  });
});
