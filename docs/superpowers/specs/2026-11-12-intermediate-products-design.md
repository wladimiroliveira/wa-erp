# Intermediate products — design

Date: 2026-11-12
Branch: `feat/intermediate-products`

## Goal

Let a manufactured product be made from other manufactured products that are made in the same
run. A "bombom de brigadeiro" takes a "casquinha" and a "recheio de brigadeiro", each a
manufactured product with its own recipe, so the recheio can also go into a "bolo de brigadeiro"
without repeating its recipe. Recipes already accept manufactured ingredients and refuse cycles;
what is missing is the pre-weighing and the production. Today the pre-weighing of the bombom
assumes the recheio is already in stock, and only reports it as a shortfall.

## Decisions

- **Every intermediate goes through stock.** An intermediate is produced by its own production
  item, comes in as a lot with its own cost, and the final product consumes it from stock like any
  other ingredient. Cost, lots and opened-leftover rules stay as they are, applied per stage.
- **One pre-weighing session covers every level.** Weighing the bombom is weighing the
  ingredients of its intermediates: the operator weighs the bought ingredients of the recheio, of
  the casquinha and of the bombom itself in one screen.
- **Ready, produce, or partly ready is one number.** For each manufactured ingredient the operator
  sets *to produce*: 0 is "ready material", the whole need is "produce", anything between is
  "partly ready". It defaults to the shortfall (`max(0, needed − in stock)`) and may exceed the
  need; the excess stays in stock.
- **Any depth.** An intermediate may itself take an intermediate; the plan is built recursively
  from the recipes, which are already acyclic.
- **The intermediate line of a pre-weighing is not weighed.** It records what is planned; the
  intermediate does not exist yet when the session happens. It leaves stock when the final product
  finishes, by the usual first-to-expire order.
- **A product with children finishes after them.** An item guided by a pre-weighing with children
  can only finish once every child's production has finished.
- **Shortage is checked before the final product finishes.** If the stock of an intermediate is
  below what the item needs (the intermediate yielded less, or something else consumed it), the
  finish is refused with the shortage and the operator chooses:
  1. **New weighing** — a new child, of the pre-weighing that guides the short item, for the
    missing quantity; it must finish before the item does, like any child;
  2. **Reduce** — lower the item's expected quantity to at most what the stock allows. Every input
    of the item, weighed or not, scales by the same ratio; what was weighed and not consumed never
    left stock, since a pre-weighing moves nothing.
- **The pre-weighing is not changed by a reduction.** It is the record of what was weighed; the
  production item carries what is consumed.
- **No reservation.** Nothing holds an intermediate for the product that needs it; the shortage
  check at finish covers another production consuming it in between.
- **No REST compatibility constraint.** The Flutter client does not exist yet; `/v1` changes and
  `openapi.json` is regenerated.

## Data

```prisma
model PreWeighing {
  // ...
  // The pre-weighing whose product takes this one's product as an ingredient; null for a root.
  parentId String?       @map("parent_id") @db.Uuid
  parent   PreWeighing?  @relation("PreWeighingStages", fields: [parentId], references: [id], onDelete: Restrict)
  children PreWeighing[] @relation("PreWeighingStages")

  @@index([parentId], map: "idx_pre_weighings_parent_id")
}

model PreWeighingItem {
  // ...
  // Null only on the line of a manufactured ingredient: it is not weighed, it is taken from stock
  // when the product finishes.
  weighedQuantity Decimal? @map("weighed_quantity") @db.Decimal(18, 6)
}
```

One migration adds the column, foreign key and index, and drops NOT NULL from
`weighed_quantity`. There is no data to migrate. The production tables do not change.

A pre-weighing's `parentId` is set on the whole tree recorded in one session and on a "new
weighing" complement; in both cases the parent's product must take the child's product in its
recipe (409 otherwise).

## Server

### Pre-weighings (`src/server/modules/pre-weighings`)

- **Plan of a stage** — `planPreWeighing` becomes recursive. For a product, a quantity and a map
  `produce: sku → quantity`, it returns the current plan plus, on every item whose product is
  `MANUFACTURED`: `needed` (the planned quantity), `inStock` (the stock balance), `toProduce`
  (from `produce`, or the shortfall by default) and `stage` (the plan of that product for
  `toProduce`, or null when it is 0). The `produce` map is keyed by SKU and applies at any depth.
  A manufactured ingredient without a recipe fails the whole plan with 409, as the root does today.
- **Preview** — `previewPreWeighing` runs lot suggestion and waste on every stage, unchanged per
  stage.
- **Record** — `recordPreWeighing` takes the tree and re-plans it through the same function, so
  what is recorded is what was shown. Per stage, the items must match the recipe as today: bought
  ingredients carry `weighedQuantity`, manufactured ones must not. Each `stages[]` entry must name
  a manufactured ingredient of its parent and match the planned `toProduce`. The whole tree is
  inserted in one transaction.
- **Complement** — the same record call with `parentId` creates a single child of an existing
  pre-weighing (the "new weighing" of a shortage). Its own manufactured ingredients may again have
  stages.
- **Presentation** — a pre-weighing presents `parentId`, `children: [{ id, product, quantity }]`
  and items with `weighedQuantity` nullable.
- The proportional quantity (`recipeQuantity × quantity ÷ yield`, stored precision) stays in
  `planQuantity`; scaling by a ratio for a reduction reuses it.

### Productions (`src/server/modules/productions`)

- **Start** — a production cannot hold a pre-weighing together with one of its descendants (409):
  it could never finish. Siblings may share a production, and share opened packagings as today.
- **Guided input quantity** — an input comes from `weighedQuantity`, or from `plannedQuantity` on
  a line that was not weighed.
- **Finish order** — before anything moves, every item guided by a pre-weighing with children
  requires each child to be guided by a `FINISHED` production; otherwise 409 naming the pending
  child pre-weighings. A child never started, or whose production was canceled, is pending.
- **Shortage check** — next, for every input of a manufactured product, the stock balance (read
  inside the finish transaction, with balances held) must cover the input quantity, adding up the
  inputs of the same product across the production's items. Otherwise 409 with
  `shortages: [{ product, needed, available }]` and nothing moves.
- **Reduce** — `reduceProductionItem(productionId, itemId, quantity)`: production `IN_PROGRESS`,
  item belongs to it, `0 < quantity < expectedQuantity`, at the unit's precision (whole for
  `UNIT`, 3 places otherwise). Sets `expectedQuantity` and multiplies each input quantity by
  `quantity ÷ expectedQuantity` at stored precision; an input that rounds to nothing is a 409.
- **Maximum allowed** — the shortage response carries, per item that is short,
  `maxQuantity`: the largest quantity at the unit's precision whose manufactured inputs the stock
  covers (`min over inputs of expected × available ÷ needed`, rounded down). The reduce dialog
  starts from it.

### REST (`src/app/v1`)

| Method and path | Change |
| --- | --- |
| `GET /v1/pre-weighings/plan` | Accepts `produce[<sku>]=<quantity>`; items gain `needed`, `inStock`, `toProduce`, `stage` (recursive plan, nullable). |
| `POST /v1/pre-weighings` | Body: `{ productSku, quantity, parentId?, items, stages[] }`, each stage `{ productSku, quantity, items, stages[] }`; `weighedQuantity` absent on manufactured lines. |
| `GET /v1/pre-weighings`, `GET /v1/pre-weighings/{id}` | Present `parentId`, `children`, nullable `weighedQuantity`. |
| `POST /v1/productions/{id}/items/{itemId}/reduce` | New. Body `{ quantity }`; returns the production. `auth` like finish. |
| `POST /v1/productions/{id}/finish` | 409 bodies for a pending child (`pendingPreWeighings`) and for a shortage (`shortages`, `items[{ itemId, maxQuantity }]`). |

`openapi.json` is regenerated with `npm run openapi:dump`.

## Client

- **`PreWeighingPage`** — a manufactured line shows *needed / in stock / to produce*, the last
  one editable (re-plans on change, like the quantity). Below it, the stage block: the same item
  table, lot suggestions and `WasteSection`, nested. The manufactured line has no weighing field.
  Submitting sends the tree. When opened with `?parentId=&productSku=&quantity=` it records a
  complement and says which pre-weighing it complements.
- **`PreWeighingDetailPage`** — links to the parent and lists the children; a line that was not
  weighed shows "do estoque".
- **`StartProductionPage`** — an available child pre-weighing shows "→ para <produto do pai>".
- **`FinishProductionForm`** — on the pending 409, a message naming what has to be produced
  first. On the shortage 409, a dialog listing each short intermediate (needed, available) with two
  actions: **Nova pesagem** (navigates to the pre-weighing screen prefilled with the product, the
  missing quantity and, as `parentId`, the pre-weighing that guides the short item) and **Reduzir** (quantity field starting at
  `maxQuantity`, calls the reduce action, then the form reloads the production).
- Actions: `planPreWeighing` and `createPreWeighing` take the new shapes; new
  `reduceProductionItem` in `src/features/productions/actions.ts`. Types from `src/lib/api.ts`.
- Screen texts in Portuguese.

## Testing (TDD: each test fails first)

- **Unit** — scaling an item's inputs by a ratio; maximum quantity from stock at the unit's
  precision; the default `toProduce`; refusing a production that mixes a pre-weighing with a
  descendant.
- **Integration (Postgres)**
  - plan of bombom ← recheio + casquinha with default, zero, partial and above-need `toProduce`;
    a two-level chain;
  - plan refused when an intermediate has no recipe;
  - recording the tree in one transaction; a stage that does not match the plan is refused and
    nothing is written;
  - a complement by `parentId`, and one whose parent does not take that product refused;
  - finishing the bombom with a child not finished → 409 pending;
  - finishing with less recheio in stock than needed → 409 shortage with `maxQuantity`, nothing
    moved;
  - reduce: inputs scaled, out-of-range quantities refused, not in progress refused;
  - full run: recheio and casquinha finish, the bombom finishes, its unit cost includes the cost
    of the recheio and casquinha lots, and the intermediate lots are consumed.
- **RTL** — to-produce field and nested stage; manufactured line without weighing field; the
  shortage dialog with both actions; the pending message.

## Out of scope

- Reserving intermediate stock for a product.
- A single production finished stage by stage (each stage is its own item, finished in its own
  production or together with its siblings).
- Changing a pre-weighing after it is recorded.
- Showing the tree in the productions list beyond the "→ para" hint.
