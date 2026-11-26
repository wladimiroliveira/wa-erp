# Production in batches ("levas"), with weighing on the production screen — design

Date: 2026-11-24
Branch: `feat/production-stages`

## Why

- **A stage that yields less passes unnoticed.** Today the casquinha can be finished with 25 of the
  50 expected; the gap only shows when the bombom finishes (shortage dialog). The kitchen's rule: an
  intermediate must cover what the main product needs, so the gap must be closed where it happens.
- **Production happens in batches over the day.** The operator makes a stage in several batches at
  different times and wants to record each one, see how much is left and, eventually, a progress bar.
- **Product already made sometimes sits outside the stock.** E.g. half of the casquinhas needed
  already exist but were never recorded; the operator must be able to bring them into the stage.
- **Making more means weighing more, without leaving the screen.** Ingredients are weighed before
  use, and that weighing happens on the production screen.

The word in the screens is **"leva"** (not "fornada": most productions involve no oven); in code,
`batch`.

## Decisions (from the user)

- A stage's target is its expected quantity. The operator records batches ("levas") as they come
  out — quantity and expiry — and sees progress ("35 de 50 · faltam 15") with a progress bar.
- Batches are progress, not stock (approach B): nothing enters or leaves stock until the item is
  concluded. Then every weighing's ingredients leave stock, and the batches enter as lots grouped by
  expiry, at the real cost (everything spent ÷ everything produced).
- When a stage yields less, the kitchen makes more: "Pesar mais uma leva" weighs the ingredients of
  another batch on the production screen, for the quantity still missing (editable).
- "Lançar do que já existe" records product that already existed outside the stock as a batch of
  the stage; it counts toward the target.
- An intermediate cannot be concluded below its target unless what was produced, plus stock, covers
  what the items taking it need; otherwise the system refuses and shows how much is missing.
- The main product may be concluded below its target after a confirmation ("Rendeu 80 de 100 un.
  Concluir assim?"), or the operator weighs another batch to reach it.
- Every weighing inside a production happens on the production screen: the extra batch, the new
  weighing after a damage and the shortage dialog's "Nova pesagem". The pre-weighing screen loses
  its "for a production" mode.

## Approach

One sensible way (the user agreed): each item keeps a list of batches and may hold several
weighings; concluding an item works as finishing does today, over the sum of its batches. The
alternative — each batch entering stock at once — was rejected for its estimated cost.

## Data

```prisma
enum ProductionBatchSource { PRODUCED  EXISTING }

model ProductionItemBatch {
  id               String                @id @default(uuid(7)) @db.Uuid
  productionItemId String                @map("production_item_id") @db.Uuid
  quantity         Decimal               @db.Decimal(18, 6)
  expiresAt        DateTime?             @map("expires_at") @db.Date
  source           ProductionBatchSource
  createdById      String                @map("created_by_id") @db.Uuid
  createdAt        DateTime              @default(now()) @map("created_at") @db.Timestamptz(3)
  @@map("production_item_batches")
}

// Weighings an item took beyond the one that guides it (extra batches). Unique: a pre-weighing
// belongs to one item.
model ProductionItemWeighing {
  productionItemId String   @map("production_item_id") @db.Uuid
  preWeighingId    String   @id @map("pre_weighing_id") @db.Uuid
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  @@map("production_item_weighings")
}
```

- An extra weighing adds its lines to the item's inputs (same product: quantities summed; weighed
  quantity, or planned on an unweighed line).
- A pre-weighing linked through `ProductionItemWeighing` reads `IN_PRODUCTION` / `PRODUCED` like the
  one that guides an item.
- `producedQuantity` on conclude = sum of the item's batches. Existing productions keep their data;
  no batch rows are back-filled.

## Server (productions)

All writes hold the production row, as today.

- **Record a batch** — `POST /v1/productions/{id}/items/{itemId}/batches`
  `{ quantity, expiresAt?, source: "PRODUCED" | "EXISTING" }`: item `PENDING`, not awaiting a
  weighing, no pending dependency; quantity > 0 at the unit's precision. `expiresAt` not in the past.
- **Remove a batch** — `DELETE …/batches/{batchId}` while the item is `PENDING` (fixing a typo).
- **Weigh a batch** — `POST /v1/productions/{id}/items/{itemId}/weighings`
  `{ quantity, items: [{ productSku, weighedQuantity }] }`: plans the item's recipe for `quantity`
  (the same planner as pre-weighings; intermediates of the recipe are taken from stock — no stages),
  records a pre-weighing (parent = the item's guiding pre-weighing's parent, if any) linked through
  `ProductionItemWeighing`, and adds its lines to the item's inputs. On an item **awaiting a
  weighing** (after a damage, or created by a shortage) the weighing guides the item instead, as
  `recordProductionWeighing` does today.
- **Conclude an item** — `POST /v1/productions/{id}/items/{itemId}/conclude`
  `{ hasLeftoversInCost, belowTarget?: boolean }`:
  - needs at least one batch; the sum of batches is the produced quantity;
  - below the expected quantity: the request must carry `belowTarget: true`; and if another item of
    the production takes this product, the produced quantity plus its stock must cover what the
    pending items taking it need (the shortage rule), else 409 with `missing` (product, quantity);
  - **What leaves stock (user's decision B):** the part of the target covered by `EXISTING` batches
    was not made now, so its ingredients were not used: every input leaves stock scaled by
    `(expected − existing) ÷ expected` (never above 1; an item made entirely of `EXISTING` batches
    consumes nothing). On the **main product concluded below target**, the lines taken from stock
    without weighing (manufactured intermediates) are further scaled by `produced ÷ expected` — the
    rest stayed on the bench; weighed lines leave whole (*call*).
  - then as finishing today: shortage check on what will leave, inputs leave stock, opened-packaging
    leftovers, cost; the `PRODUCED` batches enter as one lot per distinct expiry at
    cost of what left ÷ sum of `PRODUCED` batches; the `EXISTING` batches enter as lots (by expiry)
    at the product's current average cost (0 when none); item `FINISHED`, `closeIfResolved`.
  - The old `POST …/finish` (subset finish) is removed: the Flutter client does not exist yet and
    `/v1` is free to change (*call*).
- **Reduce** — `POST …/items/{itemId}/reduce` and the shortage dialog's "Reduzir" are removed:
  concluding the main product below target covers that case, and scaling summed weighings would be
  wrong (*call*).
- **Shortage "Nova pesagem"** — `POST /v1/productions/{id}/items` `{ productSku, quantity }` adds an
  item for the missing intermediate that **awaits a weighing** (no pre-weighing yet); its card offers
  the weighing. Replaces the complement-through-the-pre-weighing-screen flow.
- **Damage** — only on an item with no batch and no extra weighing yet (*call*: once batches exist,
  a loss is handled by recording what really came out and weighing more). Unchanged otherwise.
- **Substitute** — only on an item with no batch (*call*).
- **Cancel** — items with batches conclude with what was produced, never refused: no below-target
  rule, no shortage check (an intermediate's balance may go negative, as it happened at the bench),
  leftovers into cost, an expiry already past accepted (*call*); items without batches release their
  pre-weighings as today.

## Client (production screen)

Each Agora card (layout as today: narrow, highlighted):

- Progress: `` `${produced} de ${expected} · faltam ${missing}` `` and a progress bar; when the
  target is reached: `` `${produced} de ${expected} · meta atingida` ``.
- The list of the item's levas: time, quantity, expiry, "já existia" for `EXISTING`, a remove button.
- Actions:
  - **Registrar leva** — quantity and expiry (optional) fields + button.
  - **Pesar mais uma leva** — expands an inline weighing: "Quanto fazer" (default: what is missing),
    one row per recipe ingredient with planned and "Pesado" fields, "Registrar pesagem".
  - **Lançar do que já existe** — quantity and expiry + button.
  - **Concluir <item>** — with the leftovers preview and choice as today. Below target: an
    intermediate shows the server's refusal with what is missing; the main product asks for
    confirmation ("Rendeu 80 de 100 un. Concluir assim?").
- An item awaiting a weighing shows the inline weighing as its main action (replaces the "Nova
  pesagem" link).
- Feito gains "Leva de <item> registrada · <quantity>" per batch (with "já existia" when so) and
  keeps "<item> finalizado · <quantity>" on conclude.
- The pre-weighing screen drops `productionId` / `itemId` handling; the shortage dialog's "Nova
  pesagem" calls the add-item endpoint and the new card appears in Agora.

## Testing (TDD)

- Integration: inputs scaled by the `EXISTING` share (25 made + 25 existing of 50 → half the
  ingredients leave; all existing → nothing leaves); main product below target scales unweighed
  lines; record/remove batches and refusals; weigh an extra batch (inputs summed, pre-weighing
  linked and `IN_PRODUCTION`); conclude at target (lots per expiry, real cost, existing at average
  cost); conclude an intermediate below target refused with `missing` when its taker would lack,
  accepted when stock covers; main product below target with `belowTarget`; cancel concludes items
  with batches; damage/substitute refused once a batch exists; shortage add-item awaits a weighing;
  the old finish and reduce endpoints are gone.
- Unit: progress text; the below-target rule; lots grouped by expiry.
- RTL: card progress and levas list; registering, removing, weighing inline, existing stock;
  conclude at/below target (intermediate refusal message, main product confirmation); awaiting-weighing
  card; shortage dialog offers only "Nova pesagem", which adds the card.

## Out of scope

- Production without pre-weighing bringing its sub-products (next project).
- Recipe steps; tablet layout.
