# Stock Outflows (Sale and Donation) with Per-Lot Pricing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price manufactured products from the cost of the lots on hand every time a lot enters, and
record sales (at an editable price) and donations (at cost), with a period summary.

**Architecture:**
- **Pricing.** A `product_prices` history is written by the pricing service inside the transaction
  that enters a lot (production conclusion, entry). Its basis is a new stock read: the weighted cost
  of the unexpired lots on hand.
- **Outflows.** A new `stock-outflows` module records sales and donations as one `stock_outflows`
  row plus one `StockMovement` per lot taken, through a new "covered" take in the stock repository.
  It also lists the outflows and sums them for a period.

**Tech Stack:** Next.js App Router, Prisma/Postgres, zod, vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-11-27-stock-outflows-design.md`

## Global Constraints

- **Language.** Code, identifiers, comments and tests are in English. Only on-screen text is in
  Portuguese.
- **TDD.** Write the failing test first, and paste the red output before writing the implementation.
- **No commits** unless the user orders them. Each task ends with its targeted verification output
  pasted, and the work is left uncommitted.
- **Where rules live.** Business rules live in `service`, and `route.ts`/`actions.ts` are adapters.
  Every route declares `auth`.
- **OpenAPI.** Whenever a route changes, run `npm run openapi:dump` and keep `openapi.json` in the
  diff.
- **Front-end types.** They come from `src/lib/api.ts`, as `import type` of the zod schemas. Schemas
  must not import `@prisma/client`.
- **Money.** Prices are `Decimal(14,2)` and costs `Decimal(18,6)`. `priceFor` (`src/shared/pricing.ts`)
  rounds a price **up** to 2 places.
- **Permissions.** Recording uses `SALES_CREATE`. The list and summary use `SALES_READ`. The pricing
  screen keeps `PRICING_READ`/`PRICING_UPDATE`.
- **Verification.** Run the targeted checks: `npx vitest run <file>`,
  `npm run test:integration -- <file>`, `npm run typecheck`, `npx eslint <files>`. The full gate
  runs only if the user asks for it.

## Review Focus

1. **Two outflows racing for the same last units.** Exactly one succeeds and the other gets 409 "Not
   enough stock". Covered by the concurrency test in Task 5.
2. **A sale when the only lots left are expired.** Refused with 409, and the expired lot is left
   untouched. Covered by a test in Task 5.
3. **A product whose balance is negative (owed).** The coverage check uses the lots, not the balance:
   a lot of 5 with a balance of 2 can still sell 5. Covered by a test in Task 2.
4. **Markup changed after a price exists.** The price must not change until the next lot enters.
   Covered by a test in Task 3.
5. **A period whose `to` day is today.** It must include outflows created a moment ago, because the
   range is inclusive and in local days. Covered by a test in Task 6 and the `localDayRange` unit test.

---

### Task 1: Schema, enums and movement labels

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261127000000_add_stock_outflows_and_prices/migration.sql`
- Modify: `src/shared/enums.ts`, `src/features/stock-movements/movement-types.ts`,
  `src/server/testing/database.ts`
- Test: `src/features/stock-movements/StockMovementsPage.test.tsx`,
  `src/server/modules/stock-outflows/stock-outflows.schema.integration.test.ts`

**Interfaces:**
- **Produces, Prisma:**
  - enum `StockMovementType` gains `SALE` and `DONATION`;
  - enum `StockOutflowKind { SALE DONATION }` (`@@map("stock_outflow_kind")`);
  - model `ProductPrice` (`product_prices`): `id`, `productSku`, `averageCost Decimal(18,6)`,
    `markupPercent Decimal(7,2)`, `price Decimal(14,2)`, `createdAt`. Index
    `(productSku, createdAt desc, id desc)` named `idx_product_prices_product_sku_created_at`;
  - model `StockOutflow` (`stock_outflows`): `id`, `kind`, `productSku`, `quantity Decimal(18,6)`,
    `listPrice Decimal(14,2)?`, `unitPrice Decimal(14,2)?`, `note String?`, `createdById`,
    `createdAt`, `movements StockMovement[]`. Indexes `(createdAt)` and `(productSku, createdAt)`;
  - `StockMovement.outflowId String? @db.Uuid`, relation `outflow`, index
    `idx_stock_movements_outflow_id`.
- **Produces, shared:** `STOCK_OUTFLOW_KINDS = ["SALE", "DONATION"]`, `stockOutflowKindSchema`, and
  type `StockOutflowKind` in `src/shared/enums.ts`. `STOCK_MOVEMENT_TYPES` gains `"SALE"` and
  `"DONATION"`.

- [ ] **Step 1: Write the failing tests.**
  - In `StockMovementsPage.test.tsx`, a movement of type `SALE` renders origin "Venda" with
    direction "Saída", and `DONATION` renders "Doação" / "Saída".
  - In the new integration file:
    - inserting a `StockOutflow` with `kind: "SALE"` and `unitPrice: null` throws a check violation;
    - so does `kind: "DONATION"` with `listPrice: "1.00"`;
    - a SALE with both prices and a DONATION with neither are accepted.
- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run src/features/stock-movements`
  and `npm run test:integration -- stock-outflows.schema`. The expected failures are a type error
  (or missing label) and a missing table.
- [ ] **Step 3: Implement.**
  - Edit the schema and write the migration with `npx prisma migrate dev --name
    add_stock_outflows_and_prices --create-only`, then rename the folder to the timestamp above.
  - Append to the migration SQL:
    `ALTER TABLE stock_outflows ADD CONSTRAINT ck_stock_outflows_prices_by_kind CHECK ((kind = 'SALE' AND list_price IS NOT NULL AND unit_price IS NOT NULL) OR (kind = 'DONATION' AND list_price IS NULL AND unit_price IS NULL));`
  - Update the shared enums.
  - Add `SALE: { origin: "Venda", direction: OUT }` and `DONATION: { origin: "Doação", direction: OUT }`.
  - Add `"product_prices"` and `"stock_outflows"` to the TRUNCATE list.
- [ ] **Step 4: Run the tests and confirm they pass.** Run both commands from Step 2 and
  `npx vitest run src/shared` (the enum-equality test). All are expected to pass.

### Task 2: Stock — cost of lots on hand, and a take that refuses a shortfall

**Files:**
- Modify: `src/server/modules/stock/stock.repository.ts`
- Test: `src/server/modules/stock/stock.repository.integration.test.ts`

**Interfaces:**
- **Produces:** `onHandUnitCost(client: Prisma.TransactionClient | typeof prisma, input: { productSku: string; today: string }): Promise<Prisma.Decimal | null>`.
  - It returns Σ(quantity × unitCost) ÷ Σ quantity over the lots with `quantity > 0` that are not
    expired (`expiryOf(...) !== LotStatus.EXPIRED`), rounded to 6 places with `ROUND_HALF_UP`.
  - It returns `null` when there is no such lot.
- **Produces:** `takeCoveredFromLots(client: Prisma.TransactionClient, input: { productSku: string; quantity: Prisma.Decimal; today: string }): Promise<{ failure: "insufficient" } | { takes: { lotId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[] }>`.
  - It holds the balance (`lockStockBalance`) and then the lots (`usableLots`, `lock: true`), and
    runs `allocate`.
  - If the shortfall is > 0, it returns the failure **before** changing anything.
  - Otherwise it applies the same lot UPDATE and `decreaseStock` as `takeFromLots`. Extract that
    shared write into a private `applyTakes(client, productSku, takes, quantity)` used by both.

- [ ] **Step 1: Write the failing tests.**
  - `onHandUnitCost` with lots 80 @ 10 and 20 @ 6 → `"9.2"`.
  - With the same lots plus an expired lot 50 @ 1 → still `"9.2"`.
  - With no lots → `null`.
  - The drift example: lot A 100 @ 6 emptied to 0, B 100 @ 10, C 100 @ 10 → `"10"`.
  - `takeCoveredFromLots` with 30 asked and lots 20 (expires first) + 50 → takes `[{A, 20}, {B, 10}]`,
    lots left 0 and 40, balance −30.
  - Asking 80 from 70 → `{ failure: "insufficient" }`, with lots and balance unchanged.
  - Owed balance (balance 2, one lot of 5): asking 5 succeeds.
- [ ] **Step 2: Run them and confirm they fail.** Run
  `npm run test:integration -- stock.repository`. The expected failure is that neither function
  exists.
- [ ] **Step 3: Implement both functions** as specified in the Interfaces block.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. The new tests and the
  existing `takeFromLots` tests are expected to pass.

### Task 3: Pricing — write a price on lot entry and on the first markup

**Files:**
- Modify: `src/server/modules/pricing/pricing.repository.ts`, `pricing.service.ts`
- Modify: `src/server/modules/productions/production-batches.service.ts` (in `concludeHeld`, after
  the lot loop)
- Modify: `src/server/modules/entries/entries.repository.ts` (`insertEntry` gains
  `afterLot?: (tx: Prisma.TransactionClient) => Promise<void>`, called after `openLot`) and
  `entries.service.ts` (passes it)
- Test: `src/server/modules/pricing/pricing.service.test.ts`,
  `src/server/modules/pricing/pricing.repository.integration.test.ts`,
  `src/server/modules/entries/entries.routes.integration.test.ts`,
  `src/server/modules/productions/productions.routes.integration.test.ts`

**Interfaces:**
- **Consumes:** `onHandUnitCost` (Task 2) and `priceFor(cost: string, markup: string): string`.
- **Produces (repository):**
  - `findPricingInputs(client, sku): Promise<{ kind: ProductKind; markupPercent: Prisma.Decimal | null } | null>`;
  - `insertPrice(client, { productSku, averageCost, markupPercent, price }): Promise<void>`;
  - `findCurrentPrice(client, sku): Promise<{ price: Prisma.Decimal; averageCost: Prisma.Decimal; markupPercent: Prisma.Decimal; createdAt: Date } | null>`
    (the latest by `createdAt desc, id desc`).
- **Produces (service):** `repriceProduct(tx: Prisma.TransactionClient, input: { productSku: string; today: string }): Promise<void>`.
  - If the product is MANUFACTURED, has a markup, and `onHandUnitCost` is not null, it inserts
    `{ averageCost: basis, markupPercent, price: priceFor(basis, markup) }`.
  - Otherwise it does nothing.
- **Callers:**
  - `concludeHeld` calls `repriceProduct(tx, { productSku, today: options.today })` once, after all
    lots of the item entered.
  - `entries.service` passes `afterLot: (tx) => repriceProduct(tx, { productSku, today: localToday() })`.
  - `setMarkup`, after the upsert, calls `repriceProduct` in a `prisma.$transaction`, but **only**
    when `findCurrentPrice` returns null.

- [ ] **Step 1: Write the failing tests.**
  - Unit test (`pricing.service.test.ts`, repository and stock mocked): `repriceProduct` with basis
    `9.2` and markup `50.00` → `insertPrice` called with price `"13.80"`.
  - Unit test: GOODS → no insert.
  - Unit test: no markup → no insert.
  - Unit test: basis null → no insert.
  - Unit test: `setMarkup` with an existing price → no insert.
  - Unit test: `setMarkup` without one → `repriceProduct` runs.
  - Integration test: concluding a production of a MANUFACTURED product with markup 50 → one
    `product_prices` row whose `averageCost` equals the lots on hand.
  - Integration test: an entry of a MANUFACTURED product with markup → one row.
  - Integration test: an entry of a GOODS product → none.
  - Integration test: changing the markup after a price exists leaves the price rows unchanged
    (Review Focus 4).
- [ ] **Step 2: Run them and confirm they fail.** Run
  `npx vitest run src/server/modules/pricing` and
  `npm run test:integration -- pricing entries.routes productions.routes`.
- [ ] **Step 3: Implement** the repository functions, `repriceProduct`, and the three call sites.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same commands. They are expected to
  pass, including the existing entries and productions suites.

### Task 4: Pricing screen around the stored price

**Files:**
- Modify: `src/server/modules/pricing/pricing.schemas.ts`, `pricing.repository.ts`
  (`findPricingSources`), `pricing.service.ts` (`listPricing`)
- Modify: `src/features/pricing/PricingPage.tsx`, `PricingSheet.tsx`, `pricing-filters.ts` (only if
  it reads removed fields)
- Modify: `src/shared/pricing.ts`: delete `costPerUnit`/`ingredientSubtotal` and their tests if
  nothing else imports them (`grep -rn "shared/pricing" src`)
- Test: `pricing.service.test.ts`, `PricingPage.test.tsx`

**Interfaces:**
- **Produces:** `PricingRow`:

  ```ts
  {
    product: ProductSummary;
    status: "priced" | "no-markup" | "no-price";
    markupPercent: string | null;    // toFixed(2)
    onHandCost: string | null;       // onHandUnitCost now
    currentPrice: PriceEntry | null;
    history: PriceEntry[];           // newest first, at most 20
  }
  ```

  - `PriceEntry = { price: string /* toFixed(2) */; averageCost: string; markupPercent: string; createdAt: string /* ISO */ }`.
  - Rows: every active MANUFACTURED product (a recipe is no longer required), in description order.
  - Status: `no-markup` when there is no markup, else `no-price` when there is no price, else
    `priced`.

- [ ] **Step 1: Write the failing tests.**
  - Service unit tests for the three statuses and history order.
  - RTL test, one row:
    - "Custo médio" shows `onHandCost`;
    - the markup is editable as today;
    - "Preço" shows `currentPrice.price` with its date;
    - a row without a price shows badge "Sem preço";
    - the sheet lists the history (date, custo médio, markup, preço).
  - Remove the tests of the ingredient breakdown.
- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run src/features/pricing
  src/server/modules/pricing`.
- [ ] **Step 3: Implement.**
  - Keep the live preview of the price while typing a markup: `priceFor(onHandCost, typed)`, with a
    hint "vale a partir do próximo lote" when a price already exists.
  - Status labels: `"no-markup": "Sem markup"`, `"no-price": "Sem preço"`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command, then
  `npm run typecheck`.

### Task 5: Record a sale or donation

**Files:**
- Create: `src/server/modules/stock-outflows/stock-outflows.schemas.ts`, `.repository.ts`,
  `.service.ts`, `stock-outflows.values.ts` (+ `.values.test.ts`)
- Create: `src/app/v1/stock-outflows/route.ts` (POST)
- Modify: `src/lib/api.ts`, `openapi.json`
- Test: `src/server/modules/stock-outflows/stock-outflows.routes.integration.test.ts`

**Interfaces:**
- **Consumes:** `takeCoveredFromLots` (Task 2) and `findCurrentPrice` (Task 3).
- **Produces (schemas):**
  - `createOutflowBodySchema` = `z.discriminatedUnion("kind", [...])` with two members:
    - `{ kind: "SALE", productSku: uuid, quantity: positiveDecimalSchema, unitPrice: moneySchema, note?: optionalText(300) }`;
    - `{ kind: "DONATION", productSku, quantity, note? }`.

    Reuse the `optionalText` pattern of `losses.schemas.ts`, extracted to `src/shared/text.ts` and
    imported by both.
  - `outflowSchema` = `{ id, kind, product: productSummarySchema, quantity, listPrice: string|null, unitPrice: string|null, cost: string, revenue: string|null, profit: string|null, note: string|null, createdAt: iso datetime, createdBy: { id, name } }`.
- **Produces (values):** `outflowValues(input: { kind; quantity: Decimal; unitPrice: Decimal | null; takes: { quantity: Decimal; unitCost: Decimal }[] }): { cost: string; revenue: string | null; profit: string | null }`.
  - `cost` = Σ(q × unitCost); `revenue` = quantity × unitPrice; `profit` = revenue − cost.
  - Each is rounded to 2 places with `ROUND_HALF_UP` and `toFixed(2)`. Profit is computed from the
    rounded revenue and cost, so the rows add up on screen.
- **Produces (service):** `recordOutflow(body: CreateOutflowBody, createdById: string): Promise<Result<Outflow, 404 | 409>>`.
  - Inside one transaction:
    1. load the product (404 "Product not found."; 409 "Product is inactive.");
    2. for a SALE: 409 "Only a manufactured product can be sold." for GOODS;
    3. call `takeCoveredFromLots` with `today = localToday()` (409 "Not enough stock.");
    4. for a SALE, read `findCurrentPrice(tx)` **after** the take holds the balance (409 "The
       product has no price.", thrown to roll back, as `RefusedReason` does in losses);
    5. create the `StockOutflow`, with `listPrice` = current price and `unitPrice` from the body;
    6. create one `StockMovement` per take (`type` SALE/DONATION, `lotId`, `unitCost`,
       `outflowId`).
- **Route:** `POST /v1/stock-outflows`, `auth: Permission.SALES_CREATE`, tag `stock-outflows`.
  Responses are 201 `outflowSchema` and 404/409 `messageSchema`.

- [ ] **Step 1: Write the failing tests.**
  - Unit tests of `outflowValues`:
    - SALE of 3 at 13.80 with takes 2 @ 10 and 1 @ 6 → cost `"26.00"`, revenue `"41.40"`, profit
      `"15.40"`;
    - DONATION with the same takes → cost `"26.00"`, revenue and profit null.
  - Integration tests:
    - a sale spanning two lots → 201, two movements at each lot's cost with the same `outflowId`,
      `listPrice` = current price and `unitPrice` as sent (e.g. `"12.00"`);
    - a donation of a GOODS product → 201, no prices;
    - a sale of GOODS → 409;
    - a sale without a price → 409, with lots unchanged;
    - short stock → 409;
    - only expired lots → 409, expired lot untouched (Review Focus 2);
    - an inactive product → 409;
    - an unknown product → 404;
    - without `SALES_CREATE` → 403;
    - two concurrent POSTs for the last 5 units, each asking 5 → one 201 and one 409 (Review
      Focus 1).
- [ ] **Step 2: Run them and confirm they fail.** Run
  `npx vitest run src/server/modules/stock-outflows` and
  `npm run test:integration -- stock-outflows.routes`.
- [ ] **Step 3: Implement** the schemas, values, repository (`insertOutflow(tx, ...)`,
  `findProductForOutflow(tx, sku)`), service and route. Then run `npm run openapi:dump`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same commands, then
  `npm run typecheck`.

### Task 6: List and summarise outflows by period

**Files:**
- Modify: `src/server/lib/dates.ts` (+ test), `stock-outflows.schemas.ts`, `.repository.ts`,
  `.service.ts`, `src/app/v1/stock-outflows/route.ts` (GET)
- Create: `src/app/v1/stock-outflows/summary/route.ts`
- Modify: `src/lib/api.ts`, `openapi.json`
- Test: `src/server/lib/dates.test.ts`, `stock-outflows.routes.integration.test.ts`

**Interfaces:**
- **Produces:** `localDayRange(from: string, to: string): { gte: Date; lt: Date }`. `gte` is
  `new Date(\`${from}T00:00:00\`)` (local midnight) and `lt` is local midnight of `addDays(to, 1)`.
- **Produces (schemas):**
  - `outflowPeriodQuerySchema = z.object({ from: z.iso.date(), to: z.iso.date(), productSku: z.uuid().optional() })`,
    refined so that `from <= to`;
  - `listOutflowsQuerySchema = pageQuerySchema.extend(outflowPeriodQuerySchema.shape)` with the same
    refine;
  - `outflowPageSchema = pageSchema(outflowSchema)`;
  - `outflowSummarySchema = { revenue: string; saleCost: string; profit: string; donated: string; result: string; saleCount: number; donationCount: number }`.
- **Produces (service):**
  - `listOutflows(query): Promise<OutflowPage>`, newest first, via `pageArgs`/`toPage`;
  - `summariseOutflows(query): Promise<OutflowSummary>`. It reads every outflow of the period with
    its movements and sums `outflowValues` per outflow: `revenue`, `saleCost` and `profit` over
    sales, `donated` = Σ donation cost, and `result = profit − donated`. All values are `toFixed(2)`.
- **Routes:** `GET /v1/stock-outflows` and `GET /v1/stock-outflows/summary`, both
  `auth: Permission.SALES_READ`.

- [ ] **Step 1: Write the failing tests.**
  - Unit test: `localDayRange("2026-11-01", "2026-11-30")` → `gte` is local 2026-11-01 00:00 and
    `lt` is local 2026-12-01 00:00.
  - Integration test: two sales and one donation today, one sale dated last month (set `createdAt`
    directly).
    - The summary for this month equals the hand-computed `revenue`/`profit`/`donated`/`result`, and
      the counts are 2 and 1.
    - With `to` = today, the outflows created now are included (Review Focus 5).
    - The `productSku` filter narrows both the list and the summary.
    - The list pages with `limit: 1` and a cursor.
    - `from > to` → 400.
    - Without `SALES_READ` → 403.
- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run src/server/lib` and
  `npm run test:integration -- stock-outflows.routes`.
- [ ] **Step 3: Implement**, then run `npm run openapi:dump`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same commands, then
  `npm run typecheck`.

### Task 7: "Saídas" screen

**Files:**
- Create: `src/app/(app)/(outflows)/layout.tsx` (`RequirePermission permission="SALES_READ"`) and
  `src/app/(app)/(outflows)/stock-outflows/page.tsx`
- Create: `src/features/stock-outflows/actions.ts`, `StockOutflowsPage.tsx`, `OutflowDialog.tsx`
  (+ `.test.tsx` for both)
- Modify: `src/components/layout/nav-items.ts` (+ `AppShell.test.tsx`)
- Modify: `src/tests/samples.ts` (`anOutflow`, `anOutflowSummary` factories)

**Interfaces:**
- **Consumes:** `recordOutflow`, `listOutflows`, `summariseOutflows`, and `findCurrentPrice`/`onHandUnitCost`
  through a new service read, `outflowQuote(productSku): Promise<{ listPrice: string | null; onHandCost: string | null; available: string }>`.
  - `available` = Σ of the unexpired lots' quantity.
  - Add the read to `stock-outflows.service.ts` with its own integration test in Task 7's Step 1.
- **Produces (actions):** `registerOutflow(body)`, `loadOutflows(query)`, `loadOutflowSummary(query)`
  and `quoteOutflow(productSku)`.
  - Each checks the permission (`SALES_CREATE` for register, `SALES_READ` otherwise), parses with
    the schema and calls the service.
  - `registerOutflow` calls `revalidatePath("/stock-outflows")` on success.
- **Page.**
  - The server component reads `from`/`to`/`productSku` from `searchParams`, defaulting to the first
    and last day of the current local month.
  - It passes the first page and the summary to `StockOutflowsPage`.
- **Nav.** `{ to: "/stock-outflows", label: "Saídas", icon: PackageMinus, permission: "SALES_READ" }`,
  placed after "Movimentações".

- [ ] **Step 1: Write the failing tests** (RTL, actions mocked with `vi.mock`). The dialog:
  - Choosing "Venda" and a product calls `quoteOutflow`. It prefills "Preço" with `listPrice`
    (`13,80`) and shows "Receita", "Custo estimado" and "Lucro" for the quantity typed (3 →
    `R$ 41,40`, `R$ 27,60`, `R$ 13,80` with `onHandCost` 9.20).
  - Editing the price to `12,00` updates "Lucro" and sends `unitPrice: "12.00"`.
  - "Doação" hides the price and shows "Custo (prejuízo)".
  - A product without a price disables "Venda" with the hint "Produto sem preço".
  - A quantity above `available` shows "Estoque insuficiente" and disables submit.
  - A 409 shows the server message mapped to Portuguese: "Estoque insuficiente.", "Produto sem
    preço.", "Só produto fabricado pode ser vendido.", "Produto inativo.".
  - The "Nova saída" button is hidden without `SALES_CREATE`.

  The page:
  - The summary cards read "Vendido", "Lucro das vendas", "Doado (a custo)" and "Resultado", from
    `anOutflowSummary`.
  - The table lists date, tipo, produto, quantidade, preço, receita, custo and lucro/prejuízo.
  - Changing the period updates the URL params.
  - "Carregar mais" calls `loadOutflows` with the cursor.

  AppShell: a "Saídas" link to `/stock-outflows` for a user with `SALES_READ`.

  Service integration: `outflowQuote` returns `listPrice`, `onHandCost` and `available`, excluding
  expired lots.
- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run src/features/stock-outflows
  src/components/layout` and `npm run test:integration -- stock-outflows`.
- [ ] **Step 3: Implement.**
  - Follow `LossDialog`/`StockMovementsPage` for the components and `PricingPage` for URL filters.
  - Use `moneyOf`/`quantityOf` from `stock-format`.
  - Use the product picker the entries screen uses.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same commands, then
  `npm run typecheck` and `npx eslint src/features/stock-outflows src/app/\(app\)/\(outflows\)`.
