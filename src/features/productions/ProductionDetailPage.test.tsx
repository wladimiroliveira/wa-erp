import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { concludeItem, planProductionItem, recordBatch } from "@/features/productions/actions";
import { ProductionDetailPage } from "@/features/productions/ProductionDetailPage";
import { moneyOf } from "@/features/stock/stock-format";
import { formatDateTime } from "@/lib/dates";
import type { Permission, Production } from "@/lib/api";
import { leftoversSettled } from "@/tests/leftovers";
import { renderWithProviders } from "@/tests/render";
import {
  aCurrentUser,
  aLossReason,
  aPreWeighingPlan,
  aProduction,
  aProductionBatch,
  aProductionItem,
} from "@/tests/samples";

vi.mock("@/features/productions/actions", () => ({
  concludeItem: vi.fn(),
  recordBatch: vi.fn(),
  planProductionItem: vi.fn(),
  weighItem: vi.fn(),
  removeBatch: vi.fn(),
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
// A damage that took the item's pre-weighing away: the item waits for a new weighing.
const DAMAGED = {
  awaitsWeighing: true,
  damages: [
    {
      id: "d1",
      reason: { id: "r1", name: "Queimou" },
      note: null,
      createdAt: "2026-10-14T13:00:00.000Z",
      preWeighingId: "pw-1",
    },
  ],
};
const STAGED = aProduction({
  items: [
    aProductionItem({ id: "shell", product: product("Casquinha") }),
    aProductionItem({ id: "bombom", product: product("Bombom"), dependsOn: ["filling", "shell"] }),
    aProductionItem({ id: "filling", product: product("Recheio") }),
  ],
});

describe("ProductionDetailPage, summary", () => {
  it("titles the screen generically, leaving its date and time to the breadcrumbs", async () => {
    open();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Produção$/);

    await leftoversSettled();
  });

  it("leaves the way back to the breadcrumbs", async () => {
    open();

    expect(screen.queryByRole("link", { name: /^Voltar/ })).not.toBeInTheDocument();

    await leftoversSettled();
  });

  it("shows the status and when it started as badges, not as cards", async () => {
    const production = aProduction({ status: "IN_PROGRESS" });
    open(production);

    const summary = within(screen.getByRole("group", { name: "Resumo da produção" }));
    expect(summary.getByText("Em andamento")).toBeInTheDocument();
    expect(summary.getByText(`Iniciada em ${formatDateTime(production.createdAt)}`)).toBeInTheDocument();
    expect(summary.queryByText("Status")).not.toBeInTheDocument();

    await leftoversSettled();
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

const region = (name: string) => within(screen.getByRole("region", { name }));

const BOMBOM = aProduction({
  items: [
    aProductionItem({
      id: "shell",
      product: { sku: "shell", description: "Casquinha", unit: "UNIT" },
      status: "FINISHED",
      finishedAt: "2026-10-14T13:42:00.000Z",
      producedQuantity: "48",
    }),
    aProductionItem({ id: "bombom", product: product("Bombom"), dependsOn: ["filling", "shell"] }),
    aProductionItem({
      id: "filling",
      product: product("Recheio"),
      expectedQuantity: "0.7",
      preWeighingId: "pw-1",
    }),
  ],
});

describe("ProductionDetailPage, timeline", () => {
  it("lays the production out as done, now and next", async () => {
    open(BOMBOM);

    expect(screen.getAllByRole("heading", { level: 2 }).map(({ textContent }) => textContent)).toEqual([
      "Feito",
      "Agora",
      "Depois",
    ]);

    await leftoversSettled();
  });

  it("lists what was done with its time, and the receipt of the finished casquinha", async () => {
    open(BOMBOM);

    const done = region("Feito");
    expect(done.getByText("Produção iniciada")).toBeInTheDocument();
    expect(done.getByText(formatDateTime(BOMBOM.createdAt))).toBeInTheDocument();
    expect(done.getByText("Casquinha finalizado · 48 un")).toBeInTheDocument();
    expect(done.getByText(formatDateTime("2026-10-14T13:42:00.000Z"))).toBeInTheDocument();
    expect(done.getByRole("button", { name: "Detalhes de Casquinha" })).toBeInTheDocument();

    await leftoversSettled();
  });

  it("puts the recheio in a card of its own, with what it should yield and where it came from", async () => {
    open(BOMBOM);

    const now = region("Agora");
    expect(now.getAllByRole("region")).toHaveLength(1);
    const card = region("Recheio");
    expect(card.getByRole("heading", { level: 3, name: "Recheio" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Detalhes de Recheio" })).toBeInTheDocument();
    expect(card.getByText("Previsto 0,7 kg")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "da pré-pesagem" })).toHaveAttribute("href", "/pre-weighings/pw-1");
    expect(card.getByRole("button", { name: "Concluir Recheio" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Registrar avaria" })).toBeInTheDocument();

    await leftoversSettled();
  });

  it("keeps a card narrow, so what is inside it does not stretch across the page", async () => {
    open(BOMBOM);

    expect(screen.getByRole("region", { name: "Recheio" })).toHaveClass("max-w-xl");

    await leftoversSettled();
  });

  it("says a free item comes from the recipe", async () => {
    open();

    expect(region("Pão francês").getByText("da receita")).toBeInTheDocument();

    await leftoversSettled();
  });

  it("shows the bombom waiting for the recheio, muted, below", async () => {
    open(BOMBOM);

    const next = region("Depois");
    expect(next.getByText("Bombom · aguardando Recheio")).toBeInTheDocument();
    expect(next.getByRole("button", { name: "Detalhes de Bombom" })).toBeInTheDocument();
    expect(next.queryByRole("button", { name: "Concluir Bombom" })).not.toBeInTheDocument();
    expect(next.queryByRole("button", { name: "Registrar avaria" })).not.toBeInTheDocument();

    await leftoversSettled();
  });

  it("offers the stock on a waiting line where another item takes it", async () => {
    open(
      aProduction({
        items: [
          aProductionItem({ id: "base", product: product("Base") }),
          aProductionItem({ id: "mid", product: product("Meio"), dependsOn: ["base"] }),
          aProductionItem({ id: "top", product: product("Topo"), dependsOn: ["mid"] }),
        ],
      }),
    );

    const next = region("Depois");
    const middle = within(next.getByText("Meio · aguardando Base").closest("li")!);
    expect(middle.getByRole("button", { name: "Usar do estoque" })).toBeInTheDocument();
    const top = within(next.getByText("Topo · aguardando Meio").closest("li")!);
    expect(top.queryByRole("button", { name: "Usar do estoque" })).not.toBeInTheDocument();

    await leftoversSettled();
  });

  it("gives each ready stage its own card, and a leva registered in one goes to that item only", async () => {
    vi.mocked(recordBatch).mockResolvedValue({ ok: true, data: STAGED });
    open(STAGED);

    expect(region("Recheio").getByRole("form", { name: "Registrar leva de Recheio" })).toBeInTheDocument();
    expect(region("Casquinha").getByRole("form", { name: "Registrar leva de Casquinha" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Registrar leva de Bombom" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Quantidade da leva de Recheio"), "0,7");
    await userEvent.click(region("Recheio").getByRole("button", { name: "Registrar leva" }));

    await waitFor(() =>
      expect(recordBatch).toHaveBeenCalledWith(STAGED.id, "filling", {
        quantity: "0.7",
        expiresAt: null,
        source: "PRODUCED",
      }),
    );
    await leftoversSettled();
  });

  it("shows in a card how far its levas went, lists them and concludes only that item", async () => {
    vi.mocked(concludeItem).mockResolvedValue({ ok: true, data: STAGED });
    const withBatches = {
      ...STAGED,
      items: STAGED.items.map((item) =>
        item.id === "filling"
          ? { ...item, batches: [aProductionBatch({ quantity: "10", createdAt: "2026-10-14T12:30:00.000Z" })] }
          : item,
      ),
    };
    open(withBatches);

    const card = region("Recheio");
    expect(card.getByText("10 kg de 10 kg · meta atingida")).toBeInTheDocument();
    expect(card.getByRole("progressbar", { name: "Progresso de Recheio" })).toBeInTheDocument();
    expect(
      card.getByRole("button", { name: `Remover leva de ${formatDateTime("2026-10-14T12:30:00.000Z")}` }),
    ).toBeInTheDocument();
    expect(region("Casquinha").getByText("0 kg de 10 kg · faltam 10 kg")).toBeInTheDocument();

    await waitFor(() => expect(card.getByRole("button", { name: "Concluir Recheio" })).toBeEnabled());
    expect(region("Casquinha").getByRole("button", { name: "Concluir Casquinha" })).toBeDisabled();
    await userEvent.click(card.getByRole("button", { name: "Concluir Recheio" }));

    await waitFor(() => expect(concludeItem).toHaveBeenCalledWith(STAGED.id, "filling", { hasLeftoversInCost: true }));
  });

  it("keeps what was typed in a ready card when a refresh finishes another, and drops the card that left", async () => {
    const { rerender } = open(STAGED);

    await userEvent.type(screen.getByLabelText("Quantidade da leva de Recheio"), "0,7");
    const refreshed = {
      ...STAGED,
      items: STAGED.items.map((item) =>
        item.id === "shell"
          ? { ...item, status: "FINISHED" as const, finishedAt: "2026-10-14T13:42:00.000Z", producedQuantity: "48" }
          : { ...item },
      ),
    };
    rerender(<ProductionDetailPage production={refreshed} lossReasons={[aLossReason()]} />);

    expect(screen.getByLabelText("Quantidade da leva de Recheio")).toHaveValue("0,7");
    expect(screen.queryByRole("form", { name: "Registrar leva de Casquinha" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Casquinha" })).not.toBeInTheDocument();

    await leftoversSettled();
  });

  it("opens the weighing on a damaged item, as its main action", async () => {
    vi.mocked(planProductionItem).mockResolvedValue({ ok: true, data: aPreWeighingPlan() });
    open(
      aProduction({
        id: "prod-1",
        items: [
          aProductionItem({
            id: "shell",
            product: { sku: "sku-shell", description: "Casquinha", unit: "KILOGRAM" },
            expectedQuantity: "3",
            ...DAMAGED,
          }),
        ],
      }),
    );

    const card = region("Casquinha");
    expect(card.getByText("Avariado — faça uma nova pesagem")).toBeInTheDocument();
    expect(card.getByLabelText("Quanto fazer")).toHaveValue("3");
    expect(card.getByRole("button", { name: "Registrar pesagem" })).toBeInTheDocument();
    expect(card.queryByRole("link", { name: "Nova pesagem" })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Concluir Casquinha" })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Registrar avaria" })).not.toBeInTheDocument();

    await card.findByLabelText("Pesado de Farinha de trigo");
  });

  it.each([
    ["whoever may record production", RECORDER],
    ["a read-only user", ["PRODUCTION_READ"] satisfies Permission[]],
  ])("says an item added for a shortage, never damaged, awaits a weighing, to %s", async (_, permissions) => {
    vi.mocked(planProductionItem).mockResolvedValue({ ok: true, data: aPreWeighingPlan() });
    open(
      aProduction({
        items: [
          aProductionItem({
            id: "filling",
            product: product("Recheio"),
            preWeighingId: null,
            inputs: [],
            awaitsWeighing: true,
          }),
        ],
      }),
      permissions,
    );

    const card = region("Recheio");
    expect(card.getByText("Aguardando pesagem")).toBeInTheDocument();
    expect(card.queryByText(/Avariado/)).not.toBeInTheDocument();

    if (permissions === RECORDER) await card.findByLabelText("Pesado de Farinha de trigo");
  });

  it("offers one more leva to weigh behind a button on a card in progress", async () => {
    vi.mocked(planProductionItem).mockResolvedValue({ ok: true, data: aPreWeighingPlan() });
    const user = userEvent.setup();
    open(aProduction({ items: [aProductionItem({ id: "shell", product: product("Casquinha") })] }));

    const card = region("Casquinha");
    expect(card.queryByLabelText("Quanto fazer")).not.toBeInTheDocument();

    await user.click(card.getByRole("button", { name: "Pesar mais uma leva" }));

    expect(card.getByLabelText("Quanto fazer")).toBeInTheDocument();
    await card.findByLabelText("Pesado de Farinha de trigo");
  });

  it("says nothing of an origin on an item awaiting a new weighing", () => {
    open(
      aProduction({ items: [aProductionItem({ id: "shell", product: product("Casquinha"), awaitsWeighing: true })] }),
    );

    const card = region("Casquinha");
    expect(card.queryByText("da receita")).not.toBeInTheDocument();
    expect(card.queryByRole("link", { name: "da pré-pesagem" })).not.toBeInTheDocument();
    expect(card.getByText(/^Previsto /)).toBeInTheDocument();
  });

  it("tells a read-only user the item awaits a weighing, without telling them to weigh", () => {
    open(aProduction({ items: [aProductionItem({ id: "shell", product: product("Casquinha"), ...DAMAGED })] }), [
      "PRODUCTION_READ",
    ]);

    const card = region("Casquinha");
    expect(card.getByText("Avariado — aguardando nova pesagem")).toBeInTheDocument();
    expect(card.queryByText("Avariado — faça uma nova pesagem")).not.toBeInTheDocument();
    expect(card.queryByRole("link", { name: "Nova pesagem" })).not.toBeInTheDocument();
  });

  it("keeps the receipt of a damaged, re-weighed and finished item on its finish line only, left of the text", () => {
    open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T16:00:00.000Z",
        items: [
          aProductionItem({
            id: "shell",
            product: product("Casquinha"),
            status: "FINISHED",
            finishedAt: "2026-10-14T15:00:00.000Z",
            producedQuantity: "3",
            preWeighingId: "pw-2",
            weighedAt: "2026-10-14T14:00:00.000Z",
            damages: [
              {
                id: "d1",
                reason: { id: "r1", name: "Queimou" },
                note: null,
                createdAt: "2026-10-14T13:00:00.000Z",
                preWeighingId: null,
              },
            ],
          }),
        ],
      }),
    );

    const done = region("Feito");
    expect(done.getAllByRole("button", { name: "Detalhes de Casquinha" })).toHaveLength(1);
    const line = within(done.getByText(/^Casquinha finalizado/).closest("li")!);
    const button = line.getByRole("button", { name: "Detalhes de Casquinha" });
    expect(
      button.compareDocumentPosition(line.getByText(/^Casquinha finalizado/)) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("names the stock, not the recipe, as the origin of a substituted item's receipt", async () => {
    open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T16:00:00.000Z",
        items: [
          aProductionItem({
            id: "shell",
            product: product("Casquinha"),
            status: "SUBSTITUTED",
            substitutedAt: "2026-10-14T13:00:00.000Z",
          }),
        ],
      }),
    );

    await userEvent.click(region("Feito").getByRole("button", { name: "Detalhes de Casquinha" }));

    const sheet = within(await screen.findByRole("dialog", { name: "Casquinha" }));
    expect(sheet.getByText("Origem").nextSibling).toHaveTextContent("Estoque");
    expect(sheet.queryByText("Receita")).not.toBeInTheDocument();
  });

  it("shows the last 3 events until asked for all of them", async () => {
    const damage = (id: string, createdAt: string) => ({
      id,
      reason: { id: "r1", name: `Queimou ${id}` },
      note: null,
      createdAt,
      preWeighingId: null,
    });
    open(
      aProduction({
        items: [
          aProductionItem({
            damages: [
              damage("1", "2026-10-14T12:10:00.000Z"),
              damage("2", "2026-10-14T12:20:00.000Z"),
              damage("3", "2026-10-14T12:30:00.000Z"),
              damage("4", "2026-10-14T12:40:00.000Z"),
            ],
          }),
        ],
      }),
    );

    const done = region("Feito");
    expect(done.getAllByRole("listitem")).toHaveLength(3);
    expect(done.queryByText("Produção iniciada")).not.toBeInTheDocument();
    expect(done.getByText("Pão francês avariado · Queimou 4")).toBeInTheDocument();

    await userEvent.click(done.getByRole("button", { name: "Ver tudo (5)" }));

    expect(done.getAllByRole("listitem")).toHaveLength(5);
    expect(done.getByText("Produção iniciada")).toBeInTheDocument();
  });

  it("shows every event once a refresh brings the production finished", () => {
    const item = (id: string, description: string, finishedAt: string | null) =>
      aProductionItem({
        id,
        product: product(description),
        ...(finishedAt !== null ? { status: "FINISHED" as const, finishedAt, producedQuantity: "1" } : {}),
      });
    const running = aProduction({
      items: [
        item("a", "Recheio", "2026-10-14T13:00:00.000Z"),
        item("b", "Casquinha", "2026-10-14T14:00:00.000Z"),
        item("c", "Bombom", "2026-10-14T15:00:00.000Z"),
        item("d", "Caixa", null),
      ],
    });
    const { rerender } = open(running);
    expect(region("Feito").getAllByRole("listitem")).toHaveLength(3);

    const finished = {
      ...running,
      status: "FINISHED" as const,
      finishedAt: "2026-10-14T16:00:00.000Z",
      items: [...running.items.slice(0, 3), item("d", "Caixa", "2026-10-14T15:30:00.000Z")],
    };
    rerender(<ProductionDetailPage production={finished} lossReasons={[aLossReason()]} />);

    expect(region("Feito").getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: /^Ver tudo/ })).not.toBeInTheDocument();
  });

  it("shows a canceled production's pending items as not produced, with no actions", () => {
    open({ ...STAGED, status: "CANCELED", canceledAt: "2026-10-14T15:00:00.000Z" });

    expect(screen.queryByRole("heading", { name: "Agora" })).not.toBeInTheDocument();
    const next = region("Depois");
    for (const name of ["Bombom", "Recheio", "Casquinha"]) {
      expect(next.getByText(`${name} · Não produzido`)).toBeInTheDocument();
    }
    expect(next.queryByRole("button", { name: "Usar do estoque" })).not.toBeInTheDocument();
    expect(region("Feito").getByText("Produção cancelada")).toBeInTheDocument();
  });

  it("shows only what was done on a finished production, all of it", () => {
    const finished = (id: string, description: string, finishedAt: string) =>
      aProductionItem({ id, product: product(description), status: "FINISHED", finishedAt, producedQuantity: "1" });
    open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T16:00:00.000Z",
        items: [
          finished("a", "Recheio", "2026-10-14T13:00:00.000Z"),
          finished("b", "Casquinha", "2026-10-14T14:00:00.000Z"),
          finished("c", "Bombom", "2026-10-14T15:00:00.000Z"),
        ],
      }),
    );

    expect(screen.getAllByRole("heading", { level: 2 }).map(({ textContent }) => textContent)).toEqual(["Feito"]);
    expect(region("Feito").getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /^Ver tudo/ })).not.toBeInTheDocument();
  });

  it("shows a read-only user no finish or action buttons, only the receipts", () => {
    open(STAGED, ["PRODUCTION_READ"]);

    expect(screen.getByRole("heading", { name: "Agora" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Concluir / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar leva" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar avaria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar do estoque" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar produção" })).not.toBeInTheDocument();
    expect(region("Recheio").getByRole("button", { name: "Detalhes de Recheio" })).toBeInTheDocument();
  });

  it("tells the cancel dialog whether items were already finished", async () => {
    const user = userEvent.setup();
    open(aProduction({ items: [aProductionItem({ status: "FINISHED" }), aProductionItem({ id: "other" })] }));

    await user.click(screen.getByRole("button", { name: "Cancelar produção" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Os itens já finalizados continuam no estoque.");
  });

  it("keeps the cancel at the end of the page", async () => {
    open(BOMBOM);

    const cancel = screen.getByRole("button", { name: "Cancelar produção" });
    const next = screen.getByRole("region", { name: "Depois" });
    expect(next.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await leftoversSettled();
  });
});

// The item's details live behind the receipt button left of its name.
async function details(name: string) {
  await userEvent.click(screen.getAllByRole("button", { name: `Detalhes de ${name}` })[0]!);

  return within(await screen.findByRole("dialog", { name }));
}

describe("ProductionDetailPage", () => {
  it("keeps each item's details behind a receipt button left of its name", async () => {
    open();

    const item = screen.getByRole("region", { name: "Pão francês" });
    const button = within(item).getByRole("button", { name: "Detalhes de Pão francês" });
    const heading = within(item).getByRole("heading", { name: "Pão francês" });
    expect(button.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(item).queryByRole("table")).not.toBeInTheDocument();

    await leftoversSettled();
  });

  it("shows each item with its origin, quantities and inputs", async () => {
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

    const guided = await details("Pão francês");
    expect(guided.getByRole("link", { name: "Pré-pesagem" })).toHaveAttribute(
      "href",
      "/pre-weighings/018f0000-0000-7000-8000-0000000000a0",
    );
    expect(guided.getByText("10 kg")).toBeInTheDocument();
    expect(guided.getByRole("cell", { name: "Farinha de trigo" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    const free = await details("Pão de queijo");
    expect(free.getByText("Receita")).toBeInTheDocument();
    expect(free.getByText("4 kg")).toBeInTheDocument();
  });

  it("shows the costs of a finished production", async () => {
    open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T15:00:00.000Z",
        items: [
          aProductionItem({
            status: "FINISHED",
            finishedAt: "2026-10-14T14:00:00.000Z",
            producedQuantity: "9.5",
            unitCost: "2.5",
            inputs: [{ ...aProductionItem().inputs[0]!, unitCost: "1.2" }],
          }),
        ],
      }),
    );

    expect(screen.getByText(/^Finalizada em/)).toBeInTheDocument();
    const item = await details("Pão francês");
    expect(item.getByText("9,5 kg")).toBeInTheDocument();
    expect(item.getByText(moneyOf("2.5"))).toBeInTheDocument();
    expect(item.getByText(moneyOf("1.2"))).toBeInTheDocument();
  });

  it("tells what was discarded of opened packagings and whether its cost went into the production", async () => {
    const milk = { sku: "sku-milk", description: "Leite condensado", unit: "GRAM" as const };

    open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T15:00:00.000Z",
        items: [
          aProductionItem({
            status: "FINISHED",
            finishedAt: "2026-10-14T14:00:00.000Z",
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

    const item = await details("Pão francês");
    expect(item.getByRole("columnheader", { name: "Sobra descartada" })).toBeInTheDocument();
    const [, milkRow, flourRow] = item.getAllByRole("row").map((row) => within(row));
    expect(milkRow!.getByText("95 g · R$ 1,90")).toBeInTheDocument();
    expect(flourRow!.getByText("—")).toBeInTheDocument();
    expect(item.getByText("Sobras no custo")).toBeInTheDocument();
    expect(item.getByText("Sim")).toBeInTheDocument();
  });

  it("shows the leftover choice on each finished item, not as one fact of the production", async () => {
    const discarded = (over: Partial<Production["items"][number]>) =>
      aProductionItem({
        status: "FINISHED",
        finishedAt: "2026-10-14T14:00:00.000Z",
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

    expect(within(screen.getByRole("group", { name: "Resumo da produção" })).queryByText("Sobras no custo")).toBeNull();
    expect((await details("Recheio")).getByText("Sim")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect((await details("Casquinha")).getByText("Não")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect((await details("Bombom")).queryByText("Sobras no custo")).not.toBeInTheDocument();
  });

  it("says when the leftovers were kept out of the cost, and says nothing while in progress", async () => {
    const discarded = aProductionItem({
      inputs: [{ ...aProductionItem().inputs[0]!, leftovers: [{ lotId: "lot-1", quantity: "0.1", unitCost: "2" }] }],
    });
    const { unmount } = open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T15:00:00.000Z",
        items: [
          { ...discarded, status: "FINISHED", finishedAt: "2026-10-14T14:00:00.000Z", hasLeftoversInCost: false },
        ],
      }),
    );

    expect((await details("Pão francês")).getByText("Não")).toBeInTheDocument();
    unmount();

    open(aProduction());
    expect((await details("Pão francês")).queryByText("Sobras no custo")).not.toBeInTheDocument();
  });

  it("says nothing of leftovers when nothing was discarded", async () => {
    open(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T15:00:00.000Z",
        items: [aProductionItem({ status: "FINISHED", finishedAt: "2026-10-14T14:00:00.000Z" })],
      }),
    );

    const item = await details("Pão francês");
    expect(item.queryByText("Sobras no custo")).not.toBeInTheDocument();
    expect(item.queryByRole("columnheader", { name: "Sobra descartada" })).not.toBeInTheDocument();
  });

  it("offers finishing while in progress to whoever may record production", async () => {
    open();

    expect(screen.getByRole("button", { name: "Concluir Pão francês" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar produção" })).toBeInTheDocument();

    await leftoversSettled();
  });

  it("offers no finishing once the production is closed", () => {
    open(aProduction({ status: "CANCELED", canceledAt: "2026-10-14T15:00:00.000Z" }));

    expect(screen.getByText(/^Cancelada em/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Concluir Pão francês" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar produção" })).not.toBeInTheDocument();
  });

  it("offers no finishing to whoever may only read production", () => {
    open(aProduction(), ["PRODUCTION_READ"]);

    expect(screen.queryByRole("button", { name: "Concluir Pão francês" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar produção" })).not.toBeInTheDocument();
  });
});
