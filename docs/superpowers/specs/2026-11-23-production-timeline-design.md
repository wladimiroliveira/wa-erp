# Production screen as a timeline — design

Date: 2026-11-23
Branch: `feat/production-stages`

## Why

The production screen should coordinate the work at the bench. Today it lists the items as a tree
with a state each, a row of buttons per item, and one finish form at the bottom for every item. It
reads as a record, not as a guide: the operator has to work out what to do now. Hiding the facts and
inputs behind the receipt button did not fix that.

The user: the **operator at the bench, during the production**, on a **notebook with keyboard and
mouse**. Tablet support comes later, on its own.

Recipes have no steps yet (only ingredients and yield). When they do, the steps belong inside each
stage of this screen. This design does not add them.

## Goals

- Show at a glance what was done, what is being done and what comes next, in the order of the work.
- Put the action of the moment where the operator looks: finishing a stage happens inside that stage.
- Keep what is not acted on at the bench (costs, inputs) out of the way.
- Leave room for recipe steps inside each stage, later, without redoing the screen.

## Non-goals

- Recipe steps (a separate project).
- Tablet or phone layout.
- Changing what finish, damage, substitute, new weighing, reduce and cancel do on the server.

## Approaches considered

- **A) Vertical timeline — chosen.** One column, top to bottom: done (collapsed), now (highlighted,
  with the actions inside), next (muted). Reads in the order of the work; recipe steps fit inside a
  stage.
- **B) Three columns (now / next / done).** Uses the notebook's width, but the order between stages
  is lost across columns and recipe steps would be squeezed.
- **C) Stage list on the left, current stage on the right.** Strong focus on one stage, but the
  operator loses the whole run at a glance when two stages run at the same time.

## Design

### Sections, top to bottom

1. **Feito** — a list of events, oldest first, collapsed to the last 3 with "Ver tudo (N)" to expand.
   Each line: time, what happened, the item, and — on the lines of a finished or substituted item —
   that item's receipt button, so its facts, inputs and costs stay reachable after it leaves Agora
   (*call*). Events:
   - "Produção iniciada" — production `createdAt`;
   - "<item> finalizado · <produced quantity>" — item `finishedAt`;
   - "<item> avariado · <reason>" — each damage `createdAt`;
   - "<item> substituído pelo estoque" — item `substitutedAt` (new, see Data);
   - "Nova pesagem de <item>" — the `createdAt` of the pre-weighing an item took after its latest
     damage (*call*: earlier re-weighings of an item damaged twice show only through their damage
     events);
   - "Pesagem adicional de <item>" — an item a shortage complement added to the production, at the
     `createdAt` of its pre-weighing;
   - "Produção finalizada" / "Produção cancelada" — production `finishedAt` / `canceledAt`.
2. **Agora** — one card per item that can be worked on now: `PENDING`, not awaiting a weighing,
   no pending dependency (the current `finishableItems`), plus each item **awaiting a weighing**
   (it needs an action now: the new weighing). Each card:
   - the receipt button (details: facts and inputs, as today) and the item name, large;
   - "Previsto <quantity>" and the origin ("da pré-pesagem" link / "da receita");
   - for a ready item: an inline finish — "Produzido" and "Validade (opcional)" fields and a
     "Finalizar <item>" button; the leftover preview and the leftover-cost choice for that item
     appear in the card when it discards something;
   - for an item awaiting a weighing: "Avariado — faça uma nova pesagem" and the "Nova pesagem" link
     as the main action;
   - secondary actions as small outline buttons: "Registrar avaria", "Usar do estoque" (where
     allowed today).
3. **Depois** — one muted line per item that waits: "<item> · aguardando <names>", in dependency
   order (an item after what it waits for), with its receipt button. "Usar do estoque" stays on a
   waiting line where it is allowed today (an intermediate whose own sub-stages are not done yet can
   still be taken from stock — *call*).

The breadcrumbs, title and status badges stay as they are. "Cancelar produção" stays at the end of
the page.

### Behavior

- Finishing a card finishes that item alone (the server already takes a subset). Items finished in
  separate cards close their own opened-packaging leftovers; the shared-leftover case of finishing
  several at once is no longer offered by the screen (the REST API keeps it).
- After a finish, damage, substitute or new weighing the page refreshes, and items move between
  sections by their state: the timeline is computed from the production, never stored.
- A finished production shows only **Feito**, expanded. A canceled one shows **Feito**, expanded,
  and its pending items in **Depois** as "Não produzido", muted, with no actions.
- Without `PRODUCTION_CREATE` the cards show no fields or buttons (read-only), as today.
- The shortage dialog (Reduzir / Nova pesagem) opens from the card's finish, as today.

### Data

- `ProductionItem.substitutedAt DateTime?` (`substituted_at`), set by substitute. Migration adds the
  column; existing substituted items stay null and their event is shown without a time.
- The presented item gains `substitutedAt` and `weighedAt` (the `createdAt` of the pre-weighing that
  guides it, null on a free item), so the screen can place the "Nova pesagem" and "Pesagem
  adicional" events. An item counts as added by a complement when its `weighedAt` is after the
  production's `createdAt` and it has no damage.

### Code shape (builder's call within this)

- A pure function `timelineOf(production)` in `src/features/productions/` returns
  `{ done: Event[], now: ProductionItem[], next: { item, waitsFor: string[] }[] }`, unit-tested.
- The finish form becomes a per-item form inside the card (reusing its validation, the leftover
  preview for one item and the shortage handling).
- `ItemDetailsSheet` stays as the receipt button.

## Testing (TDD)

- Unit: `timelineOf` — events in order with times (including a substituted item without a time and
  a complement item); now/next split by dependency; awaiting-weighing item in now;
  finished/canceled production; events carrying their item.
- RTL: the three sections and their content for the bombom example; finishing the recheio card sends
  only that item; Ver tudo expands; read-only without permission; canceled production.
- Integration: substitute sets `substitutedAt`; the presented item carries `weighedAt`.

## Open to the builder

- Exact visual styling (colors, spacing) within the existing design system, at notebook width.
- How many done events show collapsed (3 proposed).
