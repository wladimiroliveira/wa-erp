# Production without pre-weighing brings its intermediates — design

Date: 2026-11-26
Branch: `feat/production-stages`

## Why

A production started without a pre-weighing plans only the product itself: the bombom's recheio and
casquinha are taken from stock when it concludes, and when they are short the screen only warns
"Estoque insuficiente". The kitchen wants the same as a guided production: the intermediates that
are needed come in as stages, the bombom waits for them, and each stage is made in levas.

## Decisions (from the user)

- On "Sem pré-pesagem", adding a product shows its tree of intermediates, each with "Necessário /
  No estoque / A fabricar". "A fabricar" starts at the shortfall and may be changed: 0 takes it from
  stock, more than the shortfall makes extra (which stays in stock).
- Starting the production creates an item for the product and one for each intermediate with
  "A fabricar" above 0, at any depth, with inputs planned from the recipe (no weighing).

## Approach

One sensible way: reuse the pre-weighing planner (`planPreWeighing` with a `produce` map), which
already decides how much to make of each intermediate at any depth. A second planner would duplicate
that rule.

## Design

- **Start body (free shape)** — each item gains `produce?: { productSku, quantity }[]` (a decimal ≥ 0, `decimalSchema`,
  each SKU once). The server plans the item with stages and that map (an intermediate the map does not
  name gets the planner's default, the shortfall) and turns the plan tree into items: the root, then
  every stage depth-first, each with `expectedQuantity` = its quantity and inputs = its planned lines.
  Refusals as the planner's (404 product, 409 no recipe / inactive / out of range / too many places).
- **Plan action** — `planProductionItem(target, produce?)` passes the map to the preview.
- **Screen** — the free item shows its plan as a tree (the pre-weighing screen's stage view, without
  weighing fields), with "A fabricar" editable; a change re-plans that item after a pause, as the
  pre-weighing screen does; "Iniciar produção" sends, per item, the `toProduce` of every intermediate
  of the plan on screen, so what starts is what was shown.
- **Same intermediate in two items** — each item brings its own stage (*call*); the operator can set
  one to 0.

## Testing (TDD)

- Integration: free bombom start → 3 items (bombom, recheio 0.7, casquinha 50) by default; `produce`
  recheio 1 → recheio item 1; recheio 0 → no recheio item and the bombom takes it from stock; a
  two-level chain; too many places → 409; the bombom waits for its stages (`dependsOn`).
- RTL: the tree with "A fabricar" fields; changing a value re-plans with `produce`; starting sends
  the plan's values.

## Out of scope

- Merging the same intermediate across items; weighing on the start screen.
