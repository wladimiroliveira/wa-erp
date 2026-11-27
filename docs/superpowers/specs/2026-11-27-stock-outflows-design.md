# Stock outflows: sale and donation, with per-lot pricing — design

Date: 2026-11-27
Branch: `feat/stock-outflows`

## Why

Stock only leaves today by production consumption, opened leftovers and losses (avaria). The business
needs to record the outflows that matter financially, starting with two:

- **Sale** — counted at the sale price, as revenue and profit.
- **Donation** — counted at cost, as a loss ("prejuízo").

For the sale to have a price, manufactured products need a price that the system sets and keeps. The
price is recalculated whenever a new lot comes in. It follows the real cost of what is in stock, so
that a leftover from an older, more expensive lot is not sold at a loss. It also must not jump when
that older lot runs out: the lots are sold together, at a single price.

More outflow kinds (transfer, internal use…) will come later. This first step creates only sale and
donation, on a structure that grows by kind.

## Goals

- Manufactured products get a **stored price**, recalculated on every lot entry, with history.
- Record a **sale** of a manufactured product: list price prefilled, actual price editable.
- Record a **donation** of any product, valued at the cost of the lots taken.
- Show sales and donations on the movements screen as outflows.
- A **period summary**: revenue, sale profit, donated at cost, and result (profit − donations),
  filtered by dates and product.

## Non-goals

- No customer or institution registry: an optional note carries who it was for.
- No reversal or cancellation of a sale or donation.
- No price for GOODS (purchased) products, and no sale of them.
- No invoicing, taxes, payment method or receivables.

## Anti-goals

- A price that drops to the new lot's cost while an expensive leftover is still on hand (the leftover
  sells at a loss), or one that jumps when the old lot ends.
- A sale whose profit cannot be traced to the lots it took and their real cost.

## Decisions (from the user)

- Only **manufactured** products are priced.
- The price is set **every time a new lot enters**. The basis is the weighted average cost of the
  product's stock, including the new lot: (leftover × its cost + new lot × its cost) ÷ total. That is
  then multiplied by (1 + markup). The user picked the weighted average over the "highest cost in
  stock" rule because the latter jumps when the old lot ends.
- The cost basis is the **real cost of the lots**, not the recipe's theoretical cost.
- On a sale the person **may change the price**. The sale keeps both the list price and the actual
  price, and profit comes from the actual price.
- Sales and donations are shown on the movements screen, **plus a period summary**.
- The price basis is the **lots on hand** (what is left of each at its cost), excluding expired lots.
- Sale and donation **never take expired lots**: those leave only as a loss.

## Approaches

How sale and donation are stored (the grouping of the lot movements, with price and note):

- **A — one `stock_outflows` table with a `kind`** (sale | donation). Sale-only columns are nullable,
  and a CHECK constraint ties them to the kind. The lot allocation, transaction and report live in one
  place, and new outflow kinds are a new enum value. **Chosen by the user.**
- B — separate `sales` and `donations` tables, like `stock_losses`. No nullable columns, but the
  allocation and the report have to join two tables, and every new kind is a new table.
- C — no header: price and note on `StockMovement`. A sale spanning two lots becomes two unrelated
  rows. Rejected: it breaks the report and any future reversal.

There was no real alternative for the other two parts:

- **Price history table** written in the same transaction as the lot entry.
- **Two new `StockMovementType` values**, one movement per lot taken. This keeps the balance, the
  lots and the movements screen working as they do today.

## Design

### Data

- `StockMovementType` gains `SALE` and `DONATION`.
- `StockOutflowKind` enum: `SALE`, `DONATION`.
- `ProductPrice` (`product_prices`): `id`, `productSku`, `averageCost` (Decimal 18,6: the basis),
  `markupPercent` (7,2), `price` (14,2), `createdAt`. Indexed `(productSku, createdAt desc, id desc)`.
  The current price is the latest row. Rows are only ever inserted.
- `StockOutflow` (`stock_outflows`): `id`, `kind`, `productSku`, `quantity` (18,6), `listPrice`
  (14,2, nullable), `unitPrice` (14,2, nullable: the actual price), `note` (≤ 300, nullable),
  `createdById`, `createdAt`.
  - CHECK: on `SALE`, both prices are set. On `DONATION`, both are null.
  - Indexed `(createdAt)` and `(productSku, createdAt)`.
- `StockMovement` gains `outflowId` (nullable FK to `stock_outflows`, indexed). Each movement of an
  outflow is one lot taken, with that lot's `unitCost`.

### Pricing

- **When a price is written.** Every time a lot of a MANUFACTURED product enters stock and the
  product has a markup, a `ProductPrice` row is written in the same transaction, after the lot is
  opened. The price comes from `priceFor(basis, markupPercent)` (`src/shared/pricing.ts`, rounds up).
- **Basis: the lots on hand, not the stored average.** The basis is Σ(lot.quantity × lot.unitCost) ÷
  Σ lot.quantity over the product's **unexpired** lots with quantity > 0 (expired lots will not be
  sold, so they stay out of the price; user's decision), read inside the transaction. This needs a
  new stock repository read.
  - `product_stocks.average_cost` is not used. It is a running average that does not change when
    stock leaves, and it restarts on a balance ≤ 0. It can drift from what is really held: lots
    A 100 @ 6 and B 100 @ 10, then A consumed, then C 100 @ 10 gives a stored average of 9, while
    the lots on hand average 10. This is the user's rule ("how much is left of the previous lot, at
    its cost"), so it is answered by the conversation.
  - The same basis is used for the first price on setting a markup, for the pricing screen's
    "custo médio", and for the dialog's estimate.
  - If one conclusion enters several lots, there may be several price rows. The last one wins.
  - Today the only path that enters a lot of a manufactured product is `enterProducedLot` at a
    production's conclusion (both the produced and the "already existed" lots). An entry
    (`entries`) of a manufactured product goes through the same rule: the rule is about the lot
    entering, whatever its origin. *(call)*
- **No markup.** If the product has no markup, no price is written. The product has no price until
  its next lot after a markup is set.
- **Markup change.** Changing the markup does **not** reprice. The new markup applies from the next
  lot, so the price only changes when a lot comes in. *(call, stated to the user)*
  - Exception *(call)*: if the product has **no price yet** and has stock (quantity > 0 and an
    `averageCost`), setting the markup writes the first price from the current `averageCost`.
    Without this, products that already exist could not be sold until their next production.
- **Pricing screen.** It is rebuilt around the stored price. Each manufactured product row shows:
  - current average cost and markup;
  - current price and its date, or "sem preço";
  - the price history in the side sheet.

  The theoretical recipe cost (`costPerUnit` over ingredient averages) leaves the screen. The
  `PricingRow` schema changes to match. Status becomes `priced` / `no-markup` / `no-price`.
  Whether `src/shared/pricing.ts`'s `costPerUnit`/`ingredientSubtotal` remain in use is left to the
  builder: remove them if nothing uses them any more.

### Outflows

- **Recording.** One service, `recordOutflow`, for both kinds.
  - Input: `kind`, `productSku`, `quantity` (positive decimal), `note?`, and for a sale `unitPrice`
    (money, ≥ 0).
  - In one transaction it holds the product's lots, orders them with `inOrderOfUse`, and takes the
    quantity with `allocate`.
  - It writes one `StockMovement` per lot taken (type `SALE`/`DONATION`, that lot's `unitCost`,
    `outflowId`), decreases the balance, and writes the `StockOutflow`.
- **Sale rules.**
  - The product must be MANUFACTURED (409 otherwise).
  - It must have a current price (409 "Produto sem preço"). `listPrice` is that price, read inside the
    transaction.
  - `unitPrice` comes from the person. The screen prefills it with the list price.
- **Donation rules.** Any active product. No prices.
- **Expired lots.** Neither a sale nor a donation takes from an expired lot: an expired lot leaves
  only as a loss (user's decision). `recordOutflow` takes lots through the same path as production
  consumption (`usableLots`), and expired lots do not count as available stock.
- **Not enough stock.** The outflow is refused (409) when the lots do not cover the quantity, as a
  loss is. Nothing is sold or donated beyond the stock. *(call)*
- **Cost of an outflow.** Σ(movement quantity × movement unitCost) over its movements, i.e. the real
  cost of the lots taken.
  - Sale revenue = quantity × unitPrice; sale profit = revenue − cost.
  - Donation value = cost, reported as a loss.
- **REST.**
  - `POST /v1/stock-outflows`: body discriminated by `kind`.
  - `GET /v1/stock-outflows`: list by period and product, paginated like the movements.
  - `GET /v1/stock-outflows/summary?from&to&productSku`: the summary.
  - Regenerate `openapi.json`.
- **Permissions** *(call)*: recording a sale or donation uses `SALES_CREATE`, and the list and summary
  use `SALES_READ`. Both permissions already exist and are unused.

### Screens

- **Registering.** A new "Saídas" screen (`src/features/stock-outflows`) with a "Nova saída" dialog:
  - kind (Venda / Doação), product, quantity, note;
  - for a sale, the price prefilled with the current list price and editable, plus a live
    "Receita / Custo estimado / Lucro";
  - for a donation, a live "Custo (prejuízo)".

  The estimate on screen uses the product's average cost. The stored value uses the real lots taken.
  *(call)*
- **Listing and summary.** The same screen lists the outflows: date, kind, product, quantity, price,
  revenue, cost, profit/loss. Above the list, the period summary:
  - Vendido (receita);
  - Lucro das vendas;
  - Doado (a custo);
  - Resultado = lucro − doado.

  The filters are a date range (default: the current month) and a product.
- **Movements screen.** `movement-types.ts` gains `SALE: "Venda"` and `DONATION: "Doação"`, both
  outflows.

### Tests

TDD throughout. The tests and the code they cover:

- Pricing unit tests: the weighted average example 80 × R$10 + 20 × R$6 → R$9.20 → R$13.80 at 50%.
- Integration tests:
  - a price is written on production conclusion and on entry;
  - no price without a markup;
  - first price on setting a markup.
- Outflow integration tests:
  - allocation across two lots by order of use, with the movements at each lot's cost;
  - the sale refusals: GOODS, no price, short stock;
  - the CHECK constraint;
  - summary totals.
- RTL tests for the dialog and the screen, with the actions mocked.

## Left to the builder

- Migration naming and the exact repository split between `pricing` and a new `stock-outflows`
  module. The outflow module calls the stock repository and the pricing read and does not reach into
  their internals.
- Pagination shape of the outflow list (follow `listStockMovements`).
- Navigation placement of "Saídas" in the app menu.
