# Stock units and packaging costs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show stock costs per kg/L with the balance apart from its unit, and keep each packaged lot's price to show the last price and history of every packaging.

**Architecture:** Part 1 is display only: a shared pure converter plus formatters in `stock-format.ts`, used by three screens. Part 2 adds `stock_lots.package_price`, written by the entry service and read by `GET /v1/stock/{sku}`, which gains per-lot packaging and a `packagings` summary built by a pure function; the product stock page renders it.

**Tech Stack:** Next.js App Router, Prisma 6 / PostgreSQL, zod 4, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-11-08-stock-units-and-packaging-costs-design.md`

## Global Constraints

- UI text in Portuguese; code, tests, comments in English.
- `*.schemas.ts` never import `@prisma/client` at runtime.
- `openapi.json` only through `npm run openapi:dump`.
- Money shown through `formatMoney` (2 places, half up); stored costs keep 6 places, package price 2.
- No Postgres locally: integration tests and the migration are written, run in CI.
- TDD: each test red first, output pasted.

## Review Focus

- A cost of `"0"` or a cost with 6 places on a GRAM product: `costPerReadableUnit("0.000001", "GRAM")` is `"0.001"` → shown `R$ 0,00/kg`; must not throw. Pinned in Task 1.
- A negative balance in "Saldo" (number only) must keep its sign: `amountOf("-2.5")` is `"-2,5"`. Pinned in Task 1.
- A packaging with lots only in depleted state still shows in "Embalagens" while the lots table hides depleted lots. Pinned in Task 4 (service) and Task 5 (screen).
- A loose lot of a product with packagings: "Embalagem" and "Preço emb." show "—". Pinned in Task 5.
- The migration backfill runs before the CHECK constraints, so existing packaged lots on staging do not block it. Pinned in Task 3 by the integration test inserting through the migrated schema.

---

### Task 1: Cost per kg/L and quantity formatters

**Files:**
- Modify: `src/shared/units.ts`, `src/shared/units.test.ts`
- Modify: `src/features/stock/stock-format.ts`
- Create: `src/features/stock/stock-format.test.ts`

**Interfaces:**
- Produces: `costPerReadableUnit(cost: string, unit: MeasurementUnit): { cost: string; unit: MeasurementUnit }` in `src/shared/units.ts`; `unitCostOf(cost: string | null, unit: MeasurementUnit): string` and `amountOf(quantity: string | null): string` in `stock-format.ts`.

- [ ] **Step 1: Failing tests**

```ts
// units.test.ts
it.each([
  ["0.03398", "GRAM", "33.98", "KILOGRAM"],
  ["0.0045", "MILLILITER", "4.5", "LITER"],
  ["0.000001", "GRAM", "0.001", "KILOGRAM"],
  ["12.5", "KILOGRAM", "12.5", "KILOGRAM"],
  ["3", "LITER", "3", "LITER"],
  ["2.75", "UNIT", "2.75", "UNIT"],
])("reads a cost of %s per %s as %s per %s", (cost, unit, expected, expectedUnit) =>
  expect(costPerReadableUnit(cost, unit)).toEqual({ cost: expected, unit: expectedUnit }));

// stock-format.test.ts
expect(unitCostOf("0.03398", "GRAM")).toBe("R$ 33,98/kg");
expect(unitCostOf("4.5", "UNIT")).toBe("R$ 4,50/un");   // whatever unitLabel("UNIT") writes
expect(unitCostOf(null, "GRAM")).toBe("—");
expect(amountOf("1234.5")).toBe("1.234,5");
expect(amountOf("-2.5")).toBe("-2,5");
expect(amountOf(null)).toBe("—");
```

- [ ] **Step 2: Run** `npx vitest run src/shared/units.test.ts src/features/stock/stock-format.test.ts` — FAIL (not exported).
- [ ] **Step 3: Implement.** `costPerReadableUnit`: `larger = compatibleUnits(unit)[0]`; cost per `larger` is `convert(cost, larger, unit)` (a cost moves opposite to a quantity). `unitCostOf` = `${formatMoney(cost)}/${unitLabel(unit)}` after conversion; `amountOf` = `formatDecimal`.
- [ ] **Step 4: Run** the same command — PASS.

### Task 2: Units on the stock screens

**Files:**
- Modify: `src/features/stock/StockPositionPage.tsx`, `StockPositionPage.test.tsx`
- Modify: `src/features/stock/StockProductPage.tsx`, `StockProductPage.test.tsx`
- Modify: `src/features/stock-movements/StockMovementsPage.tsx`, `StockMovementsPage.test.tsx`

**Interfaces:** Consumes Task 1.

- [ ] **Step 1: Failing tests** (samples with `product.unit: "GRAM"`, quantity `"380"`, `averageCost: "0.03398"`, `lastEntryCost: "0.03398"`):
  - Position: the row has cells `"380"`, `"g"` (column header `"Un."`), `"R$ 33,98/kg"` twice; minimum shows the number only.
  - Product page lots: header `"Un."`, cells `"380"` for "Qtd. inicial"/"Saldo", `"R$ 33,98/kg"` for "Custo unitário"; header "Saldo" still reads `"380 g"`.
  - Movements: "Custo unitário" of a gram product is `"R$ 33,98/kg"`.
- [ ] **Step 2: Run** `npx vitest run src/features/stock src/features/stock-movements` — FAIL.
- [ ] **Step 3: Implement.** Position: "Saldo" and "Mínimo" use `amountOf`, new column `{ key: "unit", header: "Un." }` right after "Saldo" with `unitLabel(item.product.unit)`; cost columns use `unitCostOf`. Product lots: same, column "Un." after "Saldo". Movements: `unitCostOf(movement.unitCost, movement.product.unit)` (check the movement carries the product unit; it does if the screen already shows quantities with a unit).
- [ ] **Step 4: Run** — PASS.

### Task 3: Package price on the lot

**Files:**
- Modify: `prisma/schema.prisma`, `prisma/tests/stock-schema.test.ts`, `prisma/tests/stock-schema.integration.test.ts`
- Create: `prisma/migrations/20261108200000_add_stock_lot_package_price/migration.sql`
- Modify: `src/server/modules/stock/stock.repository.ts` (`openLot`)
- Modify: `src/server/modules/entries/entries.service.ts`, `entries.repository.ts`, `entries.schemas.ts`, `entries.service.test.ts`, `entries.routes.integration.test.ts`
- Modify: `src/tests/samples.ts`, `openapi.json`

**Interfaces:**
- Produces: `StockLot.packagePrice: Decimal? @db.Decimal(14, 2)`; `openLot` input `packagePrice?: string`, selected lot `packagePrice`; `entrySchema.lot.packaging = { id, content, count, price: string } | null`.

- [ ] **Step 1: Failing tests.**
  - `stock-schema.test.ts`: `StockLot.packagePrice` is optional `Decimal` with `@db.Decimal(14, 2)` and `@map("package_price")`.
  - `entries.service.test.ts`: the packaged case (10 × 0.38 at "4.50") expects `insertEntry` called with `packagePrice: "4.50"`, and the response `lot.packaging` equals `{ id, content: "0.38", count: 10, price: "4.5" }` from the mocked lot (`packagePrice: new Prisma.Decimal("4.50")` → `toString()`).
  - Integration (CI): packaged entry stores `package_price = 4.50`; raw inserts refusing packaging without price, price without packaging, price `-1`.
- [ ] **Step 2: Run** `npx vitest run prisma/tests/stock-schema.test.ts src/server/modules/entries` — FAIL.
- [ ] **Step 3: Implement.** Schema field; migration = `prisma migrate diff` output (see part 2 recipe: `git show origin/main:prisma/schema.prisma` as `--from-schema-datamodel`), then append the spec's `UPDATE` backfill, then the two CHECK constraints, in that order. `insertEntry` input gains `packagePrice?: string` passed to `openLot`; `inStockUnit` returns `packagePrice: body.packagePrice`; response maps `price: lot.packagePrice.toString()` (guard null like `packageCount`). `anEntry` sample stays `packaging: null`. `npm run openapi:dump`.
- [ ] **Step 4: Run** the same command plus `npx tsc --noEmit` — PASS.

### Task 4: Packaging costs in `GET /v1/stock/{sku}`

**Files:**
- Create: `src/server/modules/stock/stock.packaging-costs.ts`, `stock.packaging-costs.test.ts`
- Modify: `src/server/modules/stock/stock.repository.ts` (`findProductWithStock`), `stock.service.ts`, `stock.schemas.ts`, `stock.routes.integration.test.ts`
- Modify: `src/lib/api.ts`, `src/tests/samples.ts`, `openapi.json`

**Interfaces:**
- Produces: `productStockSchema.lots[].packaging: { id, content, count: int, price } | null`; `productStockSchema.packagings: PackagingCost[]` with
  `PackagingCost = { id; content; isActive; lastEntry: { price; createdAt; supplier: {id,name}|null } | null; history: { lotId; createdAt; supplier|null; count; price }[] }`.
  `packagingCostsOf(packagings: { id; content: Decimal; isActive; lots: { id; createdAt: Date; packageCount: number|null; packagePrice: Decimal|null; supplier }[] }[]): PackagingCost[]`.
  Types `PackagingCost` and `PackagingEntry` exported from `src/lib/api.ts`; samples `aPackagingCost()`.

- [ ] **Step 1: Failing tests** (`stock.packaging-costs.test.ts`):
  - history newest first; `lastEntry` equals the first history row's price/date/supplier;
  - an active packaging without lots → `lastEntry: null`, `history: []`;
  - an inactive packaging without lots is left out; an inactive one with lots stays;
  - output ordered by content ascending; content and price written with `toString()`.
- [ ] **Step 2: Run** `npx vitest run src/server/modules/stock` — FAIL.
- [ ] **Step 3: Implement.** Repository: lots select adds `packageCount`, `packagePrice`, `packaging: { select: { id, content } }`; product select adds `packagings: { orderBy: { content: "asc" }, select: { id, content, isActive, lots: { orderBy: { createdAt: "desc" }, select: { id, createdAt, packageCount, packagePrice, supplier } } } }` (all lots, not filtered by `depleted`). Service maps lot packaging (null unless packaging, count and price all present) and `packagings: packagingCostsOf(found.packagings)`. Integration: a depleted packaged lot appears in `history` with `depleted=false`. `npm run openapi:dump`.
- [ ] **Step 4: Run** `npx vitest run src/server/modules/stock` + `npx tsc --noEmit` — PASS.

### Task 5: Packagings section and lot columns on the product stock page

**Files:**
- Modify: `src/features/stock/StockProductPage.tsx`, `StockProductPage.test.tsx`
- Create (if the section passes ~80 lines): `src/features/stock/PackagingCostsSection.tsx`

**Interfaces:** Consumes Task 1 (`unitCostOf`), Task 4 types, `packageUnitCost` (`src/shared/packaging-entry.ts`), `readableQuantity` + `formatDecimal` + `unitLabel` for "380 g", `Dialog` from `src/components/ui/dialog.tsx`.

- [ ] **Step 1: Failing tests** (product in GRAM; packaging 380 g, content `"380"`, last price `"12.91"`):
  - section heading "Embalagens"; row cells "380 g", "R$ 12,91", "R$ 33,97/kg" (12.91 ÷ 380 = 0.033974 → ×1000 = 33.974 → R$ 33,97), the formatted date and supplier name;
  - inactive packaging shows "Inativa"; one with `lastEntry: null` shows "Sem entradas";
  - clicking "Histórico" opens a dialog listing rows newest first (Data, Fornecedor, Quantidade, Preço);
  - no section when `packagings` is empty;
  - lots table: "Embalagem" "10 × 380 g", "Preço emb." "R$ 12,91"; a loose lot shows "—" in both.
- [ ] **Step 2: Run** `npx vitest run src/features/stock` — FAIL.
- [ ] **Step 3: Implement** as the spec's `StockProductPage` section describes.
- [ ] **Step 4: Run** — PASS.

### Task 6: Verification and review

- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint src prisma`, `npx prettier --check .` — paste output.
- [ ] Final review of the whole branch by a fresh reviewer (opus); fix Important findings with TDD; record minors on #31.
- [ ] Leave the tree uncommitted for the user's order.
