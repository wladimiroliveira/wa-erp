import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProductionDetailPage } from "@/features/productions/ProductionDetailPage";
import { moneyOf } from "@/features/stock/stock-format";
import { formatDateTime } from "@/lib/dates";
import type { Permission, Production } from "@/lib/api";
import { renderWithProviders } from "@/tests/render";
import { aCurrentUser, aLossReason, aProduction, aProductionItem } from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({
  finishProductionItems: vi.fn(),
  cancelProduction: vi.fn(),
  damageProductionItem: vi.fn(),
  previewSubstitution: vi.fn(),
  substituteProductionItem: vi.fn(),
  previewLeftovers: vi.fn(async () => ({ ok: true, data: { items: [], totalCost: "0.00" } })),
}));

const RECORDER: Permission[] = ["PRODUCTION_READ", "PRODUCTION_CREATE"];

function open(production: Production = aProduction(), permissions: Permission[] = RECORDER) {
  return renderWithProviders(<ProductionDetailPage production={production} lossReasons={[aLossReason()]} />, {
    user: aCurrentUser({ permissions }),
  });
}

const product = (description: string) => ({ sku: description, description, unit: "KILOGRAM" as const });
const STAGED = aProduction({
  items: [
    aProductionItem({ id: "shell", product: product("Casquinha") }),
    aProductionItem({ id: "bombom", product: product("Bombom"), dependsOn: ["filling", "shell"] }),
    aProductionItem({ id: "filling", product: product("Recheio") }),
  ],
});

describe("ProductionDetailPage, summary", () => {
  it("titles the screen generically, leaving its date and time to the breadcrumbs", () => {
    open();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Produção$/);
  });

  it("leaves the way back to the breadcrumbs", () => {
    open();

    expect(screen.queryByRole("link", { name: /^Voltar/ })).not.toBeInTheDocument();
  });

  it("shows the status and when it started as badges, not as cards", () => {
    const production = aProduction({ status: "IN_PROGRESS" });
    open(production);

    const summary = within(screen.getByRole("group", { name: "Resumo da produção" }));
    expect(summary.getByText("Em andamento")).toBeInTheDocument();
    expect(summary.getByText(`Iniciada em ${formatDateTime(production.createdAt)}`)).toBeInTheDocument();
    expect(summary.queryByText("Status")).not.toBeInTheDocument();
  });

  it("adds when it finished or was canceled", () => {
    open(aProduction({ status: "FINISHED", finishedAt: "2026-10-14T15:00:00.000Z" }));

    expect(
      within(screen.getByRole("group", { name: "Resumo da produção" })).getByText(
        `Finalizada em ${formatDateTime("2026-10-14T15:00:00.000Z")}`,
      ),
    ).toBeInTheDocument();
  });
});

describe("ProductionDetailPage, item states", () => {
  it("shows each item with its state, the item taking others first", () => {
    open(STAGED);

    const names = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(names.slice(0, 3)).toEqual(["Bombom", "Recheio", "Casquinha"]);
    expect(
      within(screen.getByRole("region", { name: "Bombom" })).getByText("Aguardando Casquinha, Recheio"),
    ).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Casquinha" })).getByText("A produzir")).toBeInTheDocument();
  });

  it("says the pending items of a canceled production were not produced", () => {
    open({ ...STAGED, status: "CANCELED", canceledAt: "2026-10-14T15:00:00.000Z" });

    for (const name of ["Bombom", "Recheio", "Casquinha"]) {
      expect(within(screen.getByRole("region", { name })).getByText("Não produzido")).toBeInTheDocument();
    }
  });

  it("offers recheio and casquinha to finish, not bombom", () => {
    open(STAGED);

    const form = within(screen.getByRole("form", { name: "Finalizar produção" }));
    expect(form.getByRole("checkbox", { name: "Recheio" })).not.toBeChecked();
    expect(form.getByRole("checkbox", { name: "Casquinha" })).toBeInTheDocument();
    expect(form.queryByRole("checkbox", { name: "Bombom" })).not.toBeInTheDocument();
  });

  it("renders no finish form when every pending item waits or awaits a weighing", () => {
    open(
      aProduction({
        items: [
          aProductionItem({ id: "shell", product: product("Casquinha"), awaitsWeighing: true }),
          aProductionItem({ id: "bombom", product: product("Bombom"), dependsOn: ["shell"] }),
        ],
      }),
    );

    expect(screen.queryByRole("form", { name: "Finalizar produção" })).not.toBeInTheDocument();
    expect(screen.getByText("Avariado — aguardando nova pesagem")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar produção" })).toBeInTheDocument();
  });

  it("tells the cancel dialog whether items were already finished", async () => {
    const user = userEvent.setup();
    open(aProduction({ items: [aProductionItem({ status: "FINISHED" }), aProductionItem({ id: "other" })] }));

    await user.click(screen.getByRole("button", { name: "Cancelar produção" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Os itens já finalizados continuam no estoque.");
  });
});

describe("ProductionDetailPage, item actions", () => {
  const region = (name: string) => within(screen.getByRole("region", { name }));

  it("offers the damage on items ready to be made, not on those waiting for another", () => {
    open(STAGED);

    expect(region("Recheio").getByRole("button", { name: "Registrar avaria" })).toBeInTheDocument();
    expect(region("Casquinha").getByRole("button", { name: "Registrar avaria" })).toBeInTheDocument();
    expect(region("Bombom").queryByRole("button", { name: "Registrar avaria" })).not.toBeInTheDocument();
  });

  it("offers the stock only on pending items another item takes", () => {
    open(STAGED);

    expect(region("Recheio").getByRole("button", { name: "Usar do estoque" })).toBeInTheDocument();
    expect(region("Casquinha").getByRole("button", { name: "Usar do estoque" })).toBeInTheDocument();
    expect(region("Bombom").queryByRole("button", { name: "Usar do estoque" })).not.toBeInTheDocument();
  });

  it("offers neither on finished or substituted items", () => {
    open(
      aProduction({
        items: [
          aProductionItem({ id: "a", product: product("Recheio"), status: "FINISHED" }),
          aProductionItem({ id: "b", product: product("Casquinha"), status: "SUBSTITUTED" }),
          aProductionItem({ id: "c", product: product("Bombom"), dependsOn: ["a", "b"] }),
        ],
      }),
    );

    expect(screen.queryByRole("button", { name: "Usar do estoque" })).not.toBeInTheDocument();
    expect(region("Recheio").queryByRole("button", { name: "Registrar avaria" })).not.toBeInTheDocument();
    expect(region("Casquinha").queryByRole("button", { name: "Registrar avaria" })).not.toBeInTheDocument();
    expect(region("Bombom").getByRole("button", { name: "Registrar avaria" })).toBeInTheDocument();
  });

  it("links a damaged guided item to a new weighing, with no damage button", () => {
    open(
      aProduction({
        id: "prod-1",
        items: [
          aProductionItem({
            id: "shell",
            product: { sku: "sku-shell", description: "Casquinha", unit: "KILOGRAM" },
            expectedQuantity: "3",
            awaitsWeighing: true,
          }),
        ],
      }),
    );

    expect(region("Casquinha").getByRole("link", { name: "Nova pesagem" })).toHaveAttribute(
      "href",
      "/pre-weighings/new?productionId=prod-1&itemId=shell&productSku=sku-shell&quantity=3",
    );
    expect(region("Casquinha").queryByRole("button", { name: "Registrar avaria" })).not.toBeInTheDocument();
  });

  it("shows no item action without permission or outside an open production", () => {
    open(STAGED, ["PRODUCTION_READ"]);
    expect(screen.queryByRole("button", { name: "Registrar avaria" })).not.toBeInTheDocument();
  });

  it("shows no item action once the production is finished", () => {
    open(aProduction({ ...STAGED, status: "FINISHED", finishedAt: "2026-10-14T15:00:00.000Z" }));
    expect(screen.queryByRole("button", { name: "Usar do estoque" })).not.toBeInTheDocument();
  });
});

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

    expect(screen.getByText(/^Finalizada em/)).toBeInTheDocument();
    expect(screen.getByText("9,5 kg")).toBeInTheDocument();
    expect(screen.getByText(moneyOf("2.5"))).toBeInTheDocument();
    expect(screen.getByText(moneyOf("1.2"))).toBeInTheDocument();
  });

  it("tells what was discarded of opened packagings and whether its cost went into the production", () => {
    const milk = { sku: "sku-milk", description: "Leite condensado", unit: "GRAM" as const };

    open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T15:00:00.000Z",
        items: [
          aProductionItem({
            hasLeftoversInCost: true,
            producedQuantity: "1",
            unitCost: "7.9",
            inputs: [
              {
                product: milk,
                quantity: "300",
                unitCost: "0.02",
                leftovers: [{ lotId: "lot-1", quantity: "95", unitCost: "0.02" }],
              },
              { ...aProductionItem().inputs[0]!, unitCost: "1.2", leftovers: [] },
            ],
          }),
        ],
      }),
    );

    expect(screen.getByRole("columnheader", { name: "Sobra descartada" })).toBeInTheDocument();
    const [, milkRow, flourRow] = screen.getAllByRole("row").map((row) => within(row));
    expect(milkRow!.getByText("95 g · R$ 1,90")).toBeInTheDocument();
    expect(flourRow!.getByText("—")).toBeInTheDocument();
    const item = within(screen.getByRole("region", { name: "Pão francês" }));
    expect(item.getByText("Sobras no custo")).toBeInTheDocument();
    expect(item.getByText("Sim")).toBeInTheDocument();
    expect(screen.queryByText("Sobras no custo", { selector: "dt" })).toBeInTheDocument();
  });

  it("shows the leftover choice on each finished item, not as one fact of the production", () => {
    const discarded = (over: Partial<Production["items"][number]>) =>
      aProductionItem({
        status: "FINISHED",
        inputs: [{ ...aProductionItem().inputs[0]!, leftovers: [{ lotId: "lot-1", quantity: "0.1", unitCost: "2" }] }],
        ...over,
      });

    open(
      aProduction({
        items: [
          discarded({
            id: "a",
            product: { sku: "a", description: "Recheio", unit: "KILOGRAM" },
            hasLeftoversInCost: true,
          }),
          discarded({
            id: "b",
            product: { sku: "b", description: "Casquinha", unit: "KILOGRAM" },
            hasLeftoversInCost: false,
          }),
          aProductionItem({ id: "c", product: { sku: "c", description: "Bombom", unit: "KILOGRAM" } }),
        ],
      }),
    );

    expect(within(screen.getByRole("region", { name: "Recheio" })).getByText("Sim")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Casquinha" })).getByText("Não")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Bombom" })).queryByText("Sobras no custo"),
    ).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Resumo da produção" })).queryByText("Sobras no custo")).toBeNull();
  });

  it("says when the leftovers were kept out of the cost, and says nothing while in progress", () => {
    const discarded = aProductionItem({
      inputs: [{ ...aProductionItem().inputs[0]!, leftovers: [{ lotId: "lot-1", quantity: "0.1", unitCost: "2" }] }],
    });
    const { unmount } = open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T15:00:00.000Z",
        items: [{ ...discarded, hasLeftoversInCost: false }],
      }),
    );

    expect(within(screen.getByRole("region", { name: "Pão francês" })).getByText("Não")).toBeInTheDocument();
    unmount();

    open(aProduction());
    expect(screen.queryByText("Sobras no custo")).not.toBeInTheDocument();
  });

  it("says nothing of leftovers when nothing was discarded", () => {
    open(aProduction({ status: "FINISHED", finishedAt: "2026-10-14T15:00:00.000Z" }));

    expect(screen.queryByText("Sobras no custo")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Sobra descartada" })).not.toBeInTheDocument();
  });

  it("offers finishing while in progress to whoever may record production", () => {
    open();

    expect(screen.getByRole("button", { name: "Finalizar selecionados" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar produção" })).toBeInTheDocument();
  });

  it("offers no finishing once the production is closed", () => {
    open(aProduction({ status: "CANCELED", canceledAt: "2026-10-14T15:00:00.000Z" }));

    expect(screen.getByText(/^Cancelada em/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finalizar selecionados" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar produção" })).not.toBeInTheDocument();
  });

  it("offers no finishing to whoever may only read production", () => {
    open(aProduction(), ["PRODUCTION_READ"]);

    expect(screen.queryByRole("button", { name: "Finalizar selecionados" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar produção" })).not.toBeInTheDocument();
  });
});
