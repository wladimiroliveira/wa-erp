import { describe, expect, it } from "vitest";

import { aProduction, aProductionItem } from "@/tests/samples";

import { timelineOf } from "./timeline";

const product = (description: string, unit: "UNIT" | "KILOGRAM" = "KILOGRAM") => ({
  sku: `sku-${description}`,
  description,
  unit,
});

const casquinha = (over = {}) => aProductionItem({ id: "i-casquinha", product: product("Casquinha", "UNIT"), ...over });
const recheio = (over = {}) => aProductionItem({ id: "i-recheio", product: product("Recheio"), ...over });
const bombom = (over = {}) =>
  aProductionItem({
    id: "i-bombom",
    product: product("Bombom", "UNIT"),
    dependsOn: ["i-casquinha", "i-recheio"],
    ...over,
  });

const damage = (reason: string, createdAt: string) => ({
  id: `d-${createdAt}`,
  reason: { id: "r1", name: reason },
  note: null,
  createdAt,
  preWeighingId: null,
});

describe("timelineOf", () => {
  it("splits the bombom example into done, now and next", () => {
    const done = casquinha({
      status: "FINISHED",
      finishedAt: "2026-10-14T13:42:00.000Z",
      producedQuantity: "48",
    });
    const timeline = timelineOf(aProduction({ items: [bombom(), done, recheio()] }));

    expect(timeline.done.map(({ text }) => text)).toEqual(["Produção iniciada", "Casquinha finalizado · 48 un"]);
    expect(timeline.now.map(({ id }) => id)).toEqual(["i-recheio"]);
    expect(timeline.next).toEqual([
      { item: expect.objectContaining({ id: "i-bombom" }), waitsFor: ["Recheio"], notProduced: false },
    ]);
  });

  it("puts every independent pending item in now", () => {
    const timeline = timelineOf(aProduction({ items: [recheio(), casquinha()] }));

    expect(timeline.now.map(({ id }) => id)).toEqual(["i-recheio", "i-casquinha"]);
    expect(timeline.next).toEqual([]);
  });

  it("lists waitsFor alphabetically and orders next after what an item waits for", () => {
    const timeline = timelineOf(aProduction({ items: [bombom(), casquinha(), recheio()] }));

    expect(timeline.next.map(({ item }) => item.id)).toEqual(["i-bombom"]);
    expect(timeline.next[0]?.waitsFor).toEqual(["Casquinha", "Recheio"]);

    const chain = timelineOf(
      aProduction({
        items: [
          aProductionItem({ id: "top", product: product("Topo"), dependsOn: ["mid"] }),
          aProductionItem({ id: "mid", product: product("Meio"), dependsOn: ["base"] }),
          aProductionItem({ id: "base", product: product("Base") }),
        ],
      }),
    );

    expect(chain.now.map(({ id }) => id)).toEqual(["base"]);
    expect(chain.next.map(({ item }) => item.id)).toEqual(["mid", "top"]);
  });

  it("puts an item awaiting a weighing in now, after the finishable ones", () => {
    const awaiting = recheio({ awaitsWeighing: true, damages: [damage("Queimou", "2026-10-14T13:00:00.000Z")] });
    const timeline = timelineOf(aProduction({ items: [awaiting, casquinha()] }));

    expect(timeline.now.map(({ id }) => id)).toEqual(["i-casquinha", "i-recheio"]);
  });

  it("orders a damage and the new weighing by time", () => {
    const item = recheio({
      damages: [damage("Queimou", "2026-10-14T13:00:00.000Z")],
      preWeighingId: "pw-2",
      weighedAt: "2026-10-14T14:00:00.000Z",
    });
    const timeline = timelineOf(aProduction({ items: [item] }));

    expect(timeline.done.map(({ text }) => text)).toEqual([
      "Produção iniciada",
      "Recheio avariado · Queimou",
      "Nova pesagem de Recheio",
    ]);
  });

  it("orders what was done by time, not by the order of the items", () => {
    const first = casquinha({ status: "FINISHED", finishedAt: "2026-10-14T15:00:00.000Z", producedQuantity: "48" });
    const second = recheio({ status: "FINISHED", finishedAt: "2026-10-14T13:00:00.000Z", producedQuantity: "1" });
    const timeline = timelineOf(aProduction({ items: [first, second] }));

    expect(timeline.done.map(({ text }) => text)).toEqual([
      "Produção iniciada",
      "Recheio finalizado · 1 kg",
      "Casquinha finalizado · 48 un",
    ]);
  });

  it("marks only an item's finish or substitution as its last event", () => {
    const finished = recheio({
      status: "FINISHED",
      finishedAt: "2026-10-14T15:00:00.000Z",
      producedQuantity: "1",
      preWeighingId: "pw-2",
      weighedAt: "2026-10-14T14:00:00.000Z",
      damages: [damage("Queimou", "2026-10-14T13:00:00.000Z")],
    });
    const substituted = casquinha({ status: "SUBSTITUTED", substitutedAt: "2026-10-14T13:30:00.000Z" });
    const timeline = timelineOf(aProduction({ items: [finished, substituted] }));

    expect(timeline.done.filter(({ ends }) => ends).map(({ text }) => text)).toEqual([
      "Casquinha substituído pelo estoque",
      "Recheio finalizado · 1 kg",
    ]);
  });

  it("shows an additional weighing for a complement item", () => {
    const item = recheio({ preWeighingId: "pw-2", weighedAt: "2026-10-14T14:00:00.000Z" });
    const timeline = timelineOf(aProduction({ items: [item] }));

    expect(timeline.done.map(({ text }) => text)).toEqual(["Produção iniciada", "Pesagem adicional de Recheio"]);
  });

  it("does not show an additional weighing for an item weighed before the production", () => {
    const item = recheio({ preWeighingId: "pw-1", weighedAt: "2026-10-14T11:00:00.000Z" });

    expect(timelineOf(aProduction({ items: [item] })).done.map(({ text }) => text)).toEqual(["Produção iniciada"]);
  });

  it("puts a substitution without a time last, with a null at", () => {
    const substituted = recheio({ status: "SUBSTITUTED", substitutedAt: null });
    const finished = casquinha({ status: "FINISHED", finishedAt: "2026-10-14T13:42:00.000Z", producedQuantity: "48" });
    const timeline = timelineOf(aProduction({ items: [substituted, finished] }));

    expect(timeline.done.map(({ text }) => text)).toEqual([
      "Produção iniciada",
      "Casquinha finalizado · 48 un",
      "Recheio substituído pelo estoque",
    ]);
    expect(timeline.done.at(-1)?.at).toBeNull();
  });

  it("dates a substitution by substitutedAt", () => {
    const substituted = recheio({ status: "SUBSTITUTED", substitutedAt: "2026-10-14T13:00:00.000Z" });
    const timeline = timelineOf(aProduction({ items: [substituted] }));

    expect(timeline.done[1]).toMatchObject({
      at: "2026-10-14T13:00:00.000Z",
      text: "Recheio substituído pelo estoque",
    });
  });

  it("shows pending items as not produced on a canceled production", () => {
    const timeline = timelineOf(
      aProduction({
        status: "CANCELED",
        canceledAt: "2026-10-14T15:00:00.000Z",
        items: [bombom(), recheio(), casquinha()],
      }),
    );

    expect(timeline.now).toEqual([]);
    expect(timeline.next.map(({ item, waitsFor, notProduced }) => [item.id, waitsFor, notProduced])).toEqual([
      ["i-casquinha", [], true],
      ["i-recheio", [], true],
      ["i-bombom", [], true],
    ]);
    expect(timeline.done.at(-1)?.text).toBe("Produção cancelada");
  });

  it("shows only done on a finished production, ending with the finish", () => {
    const timeline = timelineOf(
      aProduction({
        status: "FINISHED",
        finishedAt: "2026-10-14T16:00:00.000Z",
        items: [casquinha({ status: "FINISHED", finishedAt: "2026-10-14T13:42:00.000Z", producedQuantity: "48" })],
      }),
    );

    expect(timeline.now).toEqual([]);
    expect(timeline.next).toEqual([]);
    expect(timeline.done.at(-1)).toEqual({
      at: "2026-10-14T16:00:00.000Z",
      text: "Produção finalizada",
      item: null,
      ends: false,
    });
  });

  it("carries the item on its events and none on the production's own", () => {
    const item = casquinha({ status: "FINISHED", finishedAt: "2026-10-14T13:42:00.000Z", producedQuantity: "48" });
    const timeline = timelineOf(aProduction({ items: [item] }));

    expect(timeline.done[0]?.item).toBeNull();
    expect(timeline.done[1]?.item).toBe(item);
  });
});
