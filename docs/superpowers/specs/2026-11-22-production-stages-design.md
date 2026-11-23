# Production stages and pre-weighing status — design

Date: 2026-11-22
Branch: `feat/production-stages`

## Why

After some use of intermediate products (spec `2026-11-12-intermediate-products-design.md`):

- **The new production screen is confusing.** It mixes production guided by a pre-weighing and
  production without one, and lets both go into the same production. Pre-weighings are listed flat:
  to produce a bombom, the operator has to find and pick the bombom's, the recheio's and the
  casquinha's pre-weighings one by one, and the server refuses a production that holds a
  pre-weighing together with one of its intermediates. Nothing shows the whole bombom run in one
  place.
- **In the kitchen, a run is made in order.** The recheio and the casquinha are made first, at the
  same time, each finished with its real yield; the bombom waits until both are done.
- **Things go wrong mid-run.** A recheio burns, or the kitchen decides to use recheio already in
  stock. Today there is no way to record either.
- **Pre-weighings have no status.** Nobody sees which ones were never produced, so they pile up.

## Decisions (from the user)

- **One production, with stages inside (approach A).** Starting from a root pre-weighing brings its
  intermediates' pre-weighings into the same production, one item each. Each item is finished on its
  own; independent items can be finished at the same time.
- **Dependency lock.** An item cannot finish until every item that makes one of its intermediates
  is finished or substituted.
- **Guided or free, never both.** A production is either guided by pre-weighings or made without
  them.
- **Damage (avaria).** Any item still in progress can be recorded as damaged: nothing it was making
  enters stock, and it can be made again after a new weighing.
- **Substitute from stock.** An intermediate's item can be resolved by stock of **the same
  product** instead of producing it. The item that takes it then consumes from stock as usual.
- **Pre-weighing status, no expiry.** Pre-weighings never expire. The list shows each one's status,
  and the top of the pre-weighings screen warns about the ones pending for more than **2 days**.
- **Pricing at finish is out of scope.**

## Approaches considered

- **A) One production with stages inside — chosen.** Items get their own state and their own
  finish; the production ends when every item is resolved. Matches how the kitchen works and keeps
  one line per run in the productions list. Costs a rework of the finish, the most delicate code
  (lots, costs, opened-packaging leftovers).
- **B) One production per stage, grouped.** Reuses today's finish almost untouched, but turns one
  run into several productions in the list, and needs a new "group" entity for damage and
  substitution to act on.
- **C) Stage state derived from what exists (lots, losses, new pre-weighings).** Rejected: damage
  and substitution leave no trace clear enough to derive state from safely.

## Concepts

**Item states** — an item of a production is in one of:

| State | Meaning | Ends the item? |
| --- | --- | --- |
| `PENDING` | to be made (also after a damage, waiting for or holding a new weighing) | no |
| `FINISHED` | made; its lot is in stock | yes |
| `SUBSTITUTED` | an intermediate taken from stock instead of being made | yes |

A damage is an **event** on an item, not a state: the item stays `PENDING`.

**Production status** — `IN_PROGRESS` while any item is `PENDING`; it becomes `FINISHED` by
itself when the last item is resolved. `CANCELED` as today (see Cancel).

**Dependency** — item X depends on item Y of the same production when Y makes a product that X
takes as an input (a manufactured input). It is read from the items, not from the pre-weighing tree
(*builder-check call*): it survives a damage and a new weighing, covers an intermediate that the
planner staged under one taker but that another taker in the tree also uses, and holds the same in
a free production.

**Pre-weighing status** — derived, never stored:

| Status | Rule, in this order |
| --- | --- |
| `DAMAGED` | a damage record names this pre-weighing |
| `PRODUCED` | the item it guides is `FINISHED` |
| `IN_PRODUCTION` | the item it guides is `PENDING` (production `IN_PROGRESS`) |
| `PENDING` | no item guides it (never started, production canceled, or item substituted) |

## Data

```prisma
enum ProductionItemStatus {
  PENDING
  FINISHED
  SUBSTITUTED
  @@map("production_item_status")
}

model ProductionItem {
  // ...
  status             ProductionItemStatus @default(PENDING)
  finishedAt         DateTime?            @map("finished_at") @db.Timestamptz(3)
  // Moved here from Production: each finish call chooses it for the items it finishes.
  hasLeftoversInCost Boolean?             @map("has_leftovers_in_cost")
  damages            ProductionItemDamage[]
}

// An item that went wrong before it finished: its inputs left stock as losses.
model ProductionItemDamage {
  id               String          @id @default(uuid(7)) @db.Uuid
  productionItemId String          @map("production_item_id") @db.Uuid
  // The pre-weighing that guided the item when it was damaged; null on a free item. Unique: a
  // pre-weighing is damaged at most once.
  preWeighingId    String?         @unique @map("pre_weighing_id") @db.Uuid
  reasonId         String          @map("reason_id") @db.Uuid
  note             String?
  losses           StockLoss[]
  createdById      String          @map("created_by_id") @db.Uuid
  createdAt        DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)
}

model StockLoss {
  // ...
  // Set on the losses a damage made, so the loss report can say where they came from.
  damageId String? @map("damage_id") @db.Uuid
}
```

`Production.hasLeftoversInCost` is dropped (copied to its items first). One migration:

- add the enum, the item columns, the damage table and `stock_losses.damage_id`;
- items of `FINISHED` productions become `FINISHED`, with `finished_at` and
  `has_leftovers_in_cost` copied from their production; all others stay `PENDING`;
- drop `productions.has_leftovers_in_cost`.

`Production.finishedAt` stays: it is when the last item was resolved.

## Server

### Pre-weighings (`src/server/modules/pre-weighings`)

- **Status** — presented as `status` (`PENDING | IN_PRODUCTION | PRODUCED | DAMAGED`), replacing
  `isAvailable`. Deleting stays allowed only for `PENDING` with every descendant `PENDING` (the
  current rule, renamed).
- **List filter** — `GET /v1/pre-weighings?status=<status>` replaces `available=true|false`;
  `&staleOnly=true` keeps only `PENDING` ones created more than 2 days ago (48 h, server clock).
- **Stale count** — `GET /v1/pre-weighings/stale-count` gives the number of stale pending
  pre-weighings for the warning (*plan call*).
- **Guided start candidates** — what the start screen offers: every `PENDING` pre-weighing whose
  parent is not `PENDING` (a root, or a complement left behind after its parent ended), with its
  `PENDING` descendants nested under it.

### Productions (`src/server/modules/productions`)

- **Start** — two shapes, exclusive:
  - guided: `{ preWeighingId }` of one start candidate; the production gets one item for it and one
    for each of its `PENDING` descendants. A descendant that is not `PENDING` cuts its branch; the
    start screen already shows only the pending ones (*plan call*).
  - free: `{ items: [{ productSku, quantity }] }`, one or more, as today.
  The rule "a pre-weighing cannot be produced together with one of its intermediates" goes away.
- **Finish items** — `POST /v1/productions/{id}/finish` takes a subset:
  `{ items: [{ id, producedQuantity, expiresAt }], hasLeftoversInCost }`. Each item must be
  `PENDING`, guided by a pre-weighing (or free), and have no `PENDING` dependency (409 naming the
  items it waits for). The shortage check, the lot consumption, the cost and the opened-packaging
  leftovers work as today **over the items finished together**: they share the packagings they
  open; items finished in different calls each close their own. Each finished item gets `FINISHED`,
  `finishedAt` and `hasLeftoversInCost`; when no item is left `PENDING`, the production becomes
  `FINISHED`.
- **Leftovers preview** — takes the item ids about to be finished.
- **Damage** — `POST /v1/productions/{id}/items/{itemId}/damage` with `{ reasonId, note? }`:
  - the item must be `PENDING`, have no `PENDING` dependency (a locked item cannot be in the making
    yet, so it has nothing to lose — *call*), and have inputs to lose (a guided item must hold a
    pre-weighing);
  - each input leaves stock as a `LOSS` movement, first-to-expire lots first, at each lot's cost,
    one `StockLoss` per lot taken, all pointing to the damage; balances may go negative as at
    finish; opened-packaging leftovers are not handled (the operator records them as losses if
    needed);
  - a guided item: the damage keeps its pre-weighing (now `DAMAGED`) and the item lets go of it;
    the item waits for a new weighing;
  - a free item: stays `PENDING` with the same inputs, ready to be made again.
  Permission: `PRODUCTION_CREATE`. The reason is one of the active loss reasons.
- **New weighing for an item** — a pre-weighing recorded for a `PENDING` item without one (after a
  damage) attaches to that item, in the same transaction as the record: the item's expected
  quantity and inputs are taken from it, as at start. Its own stages (when the recipe's
  intermediates are short again) come in as new items of the same production. It is recorded with
  the `parentId` of the damaged pre-weighing, so the tree reads right; the lock does not depend on
  it.
- **New weighing for a shortage** — the shortage dialog's "Nova pesagem" records a complement under
  the pre-weighing of the short item, as today, and it joins the same production as a new item
  (a dependency of the short item), in the same transaction.
- **Substitute** — `POST /v1/productions/{id}/items/{itemId}/substitute`: the item must be
  `PENDING` and another item of the production, in any state, must take its product (only
  intermediates). It becomes
  `SUBSTITUTED`; its pre-weighing, if it still has one, is released (`PENDING` again, so it shows in
  the stale warning if nobody uses it). Nothing moves; the item that takes it consumes from stock
  at its finish, under the shortage check. The response says the stock balance against the need,
  for the screen to warn; it does not refuse.
- **No cascade** (*call*) — substituting or damaging an item does not touch the items it depends
  on. They stay `PENDING`; the operator finishes them (their lots stay in stock) or substitutes them
  too. A new weighing after a damage plans its intermediates against stock as usual: when the
  production already has a `PENDING` item of that product, the operator sets "A fabricar" to 0.
  Recipes two levels deep are rare; cascading is left for when they show up.
- **Productions already in progress** (*call*) — the migration leaves them as they are. The
  exclusive guided/free rule and the single root apply only when starting; an older production
  with several pre-weighings, or mixed, finishes item by item under the same rules.
- **Reduce** — unchanged.
- **Cancel** — allowed while `IN_PROGRESS`, also after some items finished. Finished items keep
  their lots and costs; `PENDING` items let go of their pre-weighings (back to `PENDING`); damages
  and their losses stay. The production becomes `CANCELED`.
- **Locking** — damage, substitute, attach and finish hold the production row, as reduce and
  finish do today, so they cannot interleave. Attaching a complement holds the production too,
  which also closes the race where a complement was recorded under a production that was
  finishing.

### REST (`src/app/v1`)

| Method and path | Change |
| --- | --- |
| `GET /v1/pre-weighings` | `status`, `staleOnly` filters; `available` removed; items present `status`. |
| `GET /v1/pre-weighings/{id}` | Presents `status` instead of `isAvailable`. |
| `GET /v1/pre-weighings/start-candidates` | New. The guided start candidates, nested. |
| `POST /v1/productions` | Body is guided `{ preWeighingId }` or free `{ items }`. |
| `POST /v1/productions/{id}/finish` | Body is a subset of items; 409 for a pending dependency. |
| `POST /v1/productions/{id}/items/{itemId}/damage` | New. |
| `POST /v1/productions/{id}/items/{itemId}/substitute` | New. |
| `GET /v1/productions/{id}` and list | Items present `status`, `finishedAt`, `dependsOn: [itemId]`, damages. |

Names of new paths are the builder's to settle; `openapi.json` is regenerated.

## Client

- **Nova produção** — first a choice: "Com pré-pesagem" or "Sem pré-pesagem"; only the chosen
  form shows.
  - Com pré-pesagem: the start candidates as a tree (bombom, and under it recheio and casquinha);
    the operator picks one root and sees what will come with it; "Iniciar produção".
  - Sem pré-pesagem: the current free form, unchanged.
- **Production detail** — the items as a tree, each with its state ("A produzir", "Aguardando
  recheio, casquinha", "Finalizado", "Substituído pelo estoque", "Avariado — aguardando nova
  pesagem") and its actions:
  - **Finalizar** — the operator checks the items ready to finish and fills their yields; one form
    for all of them, with the leftover question as today.
  - **Registrar avaria** — reason (active loss reasons) and note, confirmation saying the
    ingredients go to losses.
  - **Nova pesagem** — on a damaged guided item: opens the pre-weighing screen prefilled with the
    product and quantity, recording for that item.
  - **Usar do estoque** — on an intermediate: confirmation showing stock against need, warning when
    it does not cover it.
  - **Reduzir / Nova pesagem** on a shortage — as today.
  - Cancel as today, with the text adjusted when items are already finished.
- **Pré-pesagens list** — a "Status" column with a badge, a status filter, and at the top a warning
  when there are stale pending ones: "3 pré-pesagens pendentes há mais de 2 dias", linking to the
  list filtered to them.
- **Pré-pesagem detail** — shows the status; delete only when it allows.
- Screen texts in Portuguese.

## Testing (TDD: each test fails first)

- **Unit** — pre-weighing status derivation; dependency lock by product (which items an item
  waits for, including an intermediate staged under another taker); stale cutoff at 48 h.
- **Integration (Postgres)**
  - guided start brings the pending descendants; a descendant used elsewhere is left out; mixing
    guided and free is refused;
  - finishing recheio and casquinha together shares an opened packaging; the bombom is refused
    while one of them is pending, then finishes and consumes their lots; the production becomes
    `FINISHED` only with the last item;
  - damage on a guided stage: one loss per lot taken with the reason, nothing produced, the
    pre-weighing `DAMAGED`, the bombom still locked; a new weighing attaches and the stage finishes;
  - damage on a free item; damage of a non-pending or locked item refused;
  - damage of the bombom (its stages finished) and a new weighing: the new item waits again for any
    new stage item;
  - substitute releases the pre-weighing and unlocks the parent; the parent's finish checks the
    stock; substitute of the root refused;
  - shortage complement joins the production and locks the item again;
  - cancel after a stage finished keeps its lot and releases the pending pre-weighings;
  - migration: a finished production's items read `FINISHED`.
  - pre-weighing list by status and `staleOnly`.
- **RTL** — mode choice on the start screen; candidate tree; item states and actions on the
  detail; damage and substitute confirmations; the stale warning.

## Out of scope

- Pricing at finish.
- Expiring pre-weighings automatically.
- Substituting by a different product, and partial damage (use reduce for a smaller yield).
- Handling opened-packaging leftovers in a damage.
