# Entries by Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record an entry as "N packagings at R$ X each" (or by barcode), storing the lot in the product's unit plus the packaging and count; forbid deleting a packaging that has lots.

**Architecture:** The entries service turns a packaged body into the existing quantity/unit-cost flow with pure helpers from `src/shared/packaging-entry.ts`; the lot gains two nullable columns. The entry screen looks barcodes up in the catalog it already loads.

**Tech Stack:** Next.js App Router, Prisma 6 / PostgreSQL, zod 4, react-hook-form, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-11-08-entries-by-packaging-design.md`

## Global Constraints

- Code, tests, comments in English; UI text in Portuguese.
- No commits, no push until the user asks; each task ends with its verification output.
- TDD: test first, paste the red output, then implement.
- Business rules only in services; `route.ts`/`actions.ts` are adapters; `*.schemas.ts` and `src/shared/*` never import `@prisma/client` at runtime.
- Package price: at most 2 decimals. Derived unit cost: 6 decimals, half up. Loose unit cost: 6 decimals, unchanged.
- `openapi.json` regenerated with `npm run openapi:dump`.
- Integration tests and migrations cannot run here (no Postgres): write them, say they were not run.
- The pre-commit hook runs `prettier --check .`; keep any scratch outside the repo.

## Review Focus

1. **Barcode scanner sends Enter**: must look up, never submit the form. Pinned in Task 5 (test 11).
2. **Packaging id of another product** sent with a product sku: 404, nothing written. Pinned in Task 3.
3. **Deficit dialog with a packaged entry**: resending must keep the packaged shape (packagingId, count, price) plus `deficit`. Pinned in Task 5.
4. **Product switched after a barcode filled the packaging**: the packaging select must fall back to the new product's first packaging (or loose), never keep an id of another product. Pinned in Task 5.
5. **Count × content beyond 12 integer digits** (e.g. 999999999 × 5000 g): 400, not a database error. Pinned in Task 3.

---

### Task 1: Pure packaged-entry math and money schema

**Files:**
- Create: `src/shared/packaging-entry.ts`, `src/shared/packaging-entry.test.ts`
- Modify: `src/shared/decimal.ts` (add `moneySchema`)

**Interfaces:**
- Produces:
  - `moneySchema = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/)`
  - `packagedQuantity(content: string, count: number): string` — exact, normalized (no trailing zeros)
  - `costPerUnit(packagePrice: string, content: string): string` — always 6 decimals, half up (scaled `BigInt`, reuse the approach of `src/shared/pricing.ts`)

- [ ] **Step 1: Failing tests**
  - `costPerUnit("4.50", "0.38")` → `"11.842105"`; `costPerUnit("10.00", "2")` → `"5.000000"`; `costPerUnit("0.01", "20000")` → `"0.000001"`; `costPerUnit("0.01", "30000")` → `"0.000000"`.
  - `packagedQuantity("0.38", 10)` → `"3.8"`; `packagedQuantity("1", 12)` → `"12"`; `packagedQuantity("0.000001", 3)` → `"0.000003"`.
  - `moneySchema` accepts `"4.5"`, `"4.50"`, `"0"`; refuses `"4.505"`, `"-1"`, `"4,50"`.
- [ ] **Step 2: Run `npx vitest run src/shared/packaging-entry.test.ts`** — FAIL (module missing). Paste.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.

---

### Task 2: Lot columns and migration

**Files:**
- Modify: `prisma/schema.prisma` (`StockLot.packagingId`, `packaging`, `packageCount`, `@@index([packagingId], map: "idx_stock_lots_packaging_id")`; `ProductPackaging.lots StockLot[]`)
- Create: `prisma/migrations/20261108100000_add_stock_lot_packaging/migration.sql`
- Test: `prisma/tests/stock-schema.test.ts`

- [ ] **Step 1: Failing test** (use the file's `fieldOf`): `fieldOf("StockLot", String.raw\`packagingId\s+String\?\s+@map\("packaging_id"\) @db\.Uuid\`)`, `fieldOf("StockLot", String.raw\`packageCount\s+Int\?\s+@map\("package_count"\)\`)`, `fieldOf("StockLot", String.raw\`packaging\s+ProductPackaging\?.*onDelete: Restrict\`)`; the convention test keeps passing.
- [ ] **Step 2: Run `npx vitest run --project api prisma/tests/stock-schema.test.ts`** — FAIL. Paste.
- [ ] **Step 3: Edit the schema; generate SQL with** `git show origin/main:prisma/schema.prisma > $SCRATCH/old.prisma && npx prisma migrate diff --from-schema-datamodel $SCRATCH/old.prisma --to-schema-datamodel prisma/schema.prisma --script`; append the two CHECK constraints verbatim from the spec; `npm run db:generate`.
- [ ] **Step 4: Run** — PASS. Migration not applied (no Postgres).

---

### Task 3: Entry schemas, service and repository

**Files:**
- Modify: `src/server/modules/entries/entries.schemas.ts`, `entries.service.ts`, `entries.repository.ts`, `src/server/modules/stock/stock.repository.ts` (`openLot`)
- Create: `src/server/modules/entries/entries.service.test.ts` (repository mocked: `findProductBySku`, `insertEntry`, `NegativeBalancePendingError` re-exported from the mock with `vi.importActual`; `findSupplierById` mocked from `@/server/modules/suppliers/suppliers.repository`)

**Interfaces:**
- Consumes: Task 1 `costPerUnit`, `packagedQuantity`, `moneySchema`; `decimalSchema`.
- Produces:
  - `looseEntryBodySchema`, `packagedEntryBodySchema` (both `.strict()`), `createEntryBodySchema = z.union([looseEntryBodySchema, packagedEntryBodySchema])`; `CreateEntryBody` = its input type.
  - `packagedEntryBodySchema` fields: `productSku: uuid`, `packagingId: uuid`, `packageCount: z.number().int().min(1)`, `packagePrice: moneySchema`, `expiresAt`, `supplierId?`, `deficit?` (same as loose).
  - `entrySchema.lot.packaging: z.object({ id: uuid, content: string, count: int }).nullable()`.
  - `findProductBySku(sku)` → `{ sku, description, unit, isActive, packagings: { id, content: string, isActive }[] } | null`.
  - `insertEntry(input)` gains optional `packagingId?: string; packageCount?: number`.
  - `openLot(client, lot)` gains optional `packagingId?: string; packageCount?: number`; its select adds `packageCount`, `packaging: { select: { id: true, content: true } }`.
  - Productions keep calling `openLot` without the new fields (lots of finished goods have no packaging).

- [ ] **Step 1: Failing tests**
  1. Packaged body `{ packagingId: BAG (content "0.38"), packageCount: 10, packagePrice: "4.50" }` calls `insertEntry` with `quantity: "3.8"`, `unitCost: "11.842105"`, `packagingId: BAG`, `packageCount: 10`.
  2. Packaging id not among the product's packagings → `{ ok: false, status: 404, message: "Packaging not found." }`; `insertEntry` not called.
  3. Inactive packaging → 409 `"Packaging is inactive."`.
  4. `packageCount: 999999999` with content `"5000"` → 400; `insertEntry` not called (Review Focus 5).
  5. Loose body calls `insertEntry` with the same fields as today and no packaging.
  6. Schema: a body with `quantity` and `packagingId` together fails; `packagePrice: "4.505"`, `packageCount: 1.5`, `packageCount: 0` fail.
  7. The success result's `lot.packaging` is `{ id: BAG, content: "0.38", count: 10 }` for a packaged entry, `null` for a loose one.
- [ ] **Step 2: Run `npx vitest run src/server/modules/entries/entries.service.test.ts`** — FAIL. Paste.
- [ ] **Step 3: Implement.** `recordEntry` narrows with `"packagingId" in body`; the service's result type gains 400.
- [ ] **Step 4: Run** — PASS; also `npx vitest run --project api src/server/modules/productions` to show `openLot` callers are fine.

---

### Task 4: Packaging with lots cannot be removed

**Files:**
- Modify: `src/server/modules/products/products.repository.ts` (new `findPackagingsWithLots`), `products.schemas.ts` (`PRODUCT_CONFLICTS.inUse = "A packaging with stock lots cannot be removed."`), `products.service.ts`, `src/features/products/ProductDialog.tsx` (map `inUse` to "Essa embalagem já recebeu entradas e não pode ser removida; inative-a.")
- Test: `products.service.test.ts` (add `findPackagingsWithLots` to the mocked repository), `ProductDialog.test.tsx`

**Interfaces:**
- Produces: `findPackagingsWithLots(productSku: string): Promise<string[]>` — ids of the product's packagings that some lot refers to. The product response type does not change.

- [ ] **Step 1: Failing tests:** `editProduct` with a list leaving out a packaging returned by `findPackagingsWithLots` → `{ ok: false, status: 409, message: PRODUCT_CONFLICTS.inUse }`, `updateProduct` not called; leaving out one without lots still syncs. Dialog shows the Portuguese sentence for that 409.
- [ ] **Step 2: Run both test files** — FAIL. Paste.
- [ ] **Step 3: Implement** (`findPackagingsWithLots` is called only when `packagings` is sent).
- [ ] **Step 4: Run** — PASS.

---

### Task 5: Entry screen

**Files:**
- Create: `src/features/entries/barcode.ts` — `findByGtin(products: Product[], gtin: string): { product: Product; packaging: Packaging } | null` (active products, active packagings only)
- Modify: `src/features/entries/EntryPage.tsx`
- Test: `src/features/entries/barcode.test.ts`, `src/features/entries/EntryPage.test.tsx`

**Interfaces:**
- Consumes: `readableQuantity` (`@/shared/units`), `costPerUnit`, `packagedQuantity` (Task 1), `formatMoney`/`formatDecimal` (`@/lib/decimal`).
- Form adds: `barcode: string`, `packaging: string` (packaging id or `"LOOSE"`), `packageCount: string`, `packagePrice: string`. Loose fields keep their names.
- Labels: "Código de barras", "Embalagem", "Quantidade" (packaging count), "Preço por embalagem"; option text `"380 g"` and `"Sem embalagem (kg)"`.

- [ ] **Step 1: Failing tests**
  - `barcode.test.ts`: finds product + packaging by GTIN; ignores an inactive packaging and an inactive product; unknown → null.
  8. Typing a known GTIN + Enter in "Código de barras" selects the product and "380 g", focus on "Quantidade"; an unknown GTIN shows "Código não cadastrado em nenhuma embalagem ativa.".
  9. "Embalagem" lists active packagings then "Sem embalagem (kg)"; absent for a product without packagings; inactive packagings absent.
  10. 10 × 4,50 on 380 g shows "= 3,8 kg a R$ 11,84/kg".
  11. Packaged submit sends `{ productSku, packagingId, packageCount: 10, packagePrice: "4.50", expiresAt, … }`; "Sem embalagem" sends the loose body; Enter in the barcode field never calls `createEntry`; "Preço por embalagem" with 3 decimals shows "Informe o preço com até 2 casas decimais."; "Quantidade" 0 shows "Informe um número inteiro de embalagens, de 1 a 99.999.".
  12. After recording a packaged entry the summary shows "10 × 380 g (3,8 kg)"; the barcode field has focus.
  - Review Focus 3: deficit dialog on a packaged entry resends the packaged body plus `deficit`.
  - Review Focus 4: after a barcode fills product A and its packaging, choosing product B selects B's first packaging (or hides the select for a loose-only product).
- [ ] **Step 2: Run `npx vitest run src/features/entries`** — FAIL. Paste.
- [ ] **Step 3: Implement.** The summary reads `lot.packaging` from the response with `readableQuantity`.
- [ ] **Step 4: Run** — PASS.

---

### Task 6: REST, contract, integration tests

**Files:**
- Modify: `src/app/v1/entries/route.ts` (summary mentions packagings; responses add `400`), `openapi.json`, `src/server/modules/entries/entries.routes.integration.test.ts`, `src/server/modules/products/products.routes.integration.test.ts`, `prisma/tests/stock-schema.integration.test.ts`, `src/tests/samples.ts` (`anEntry().lot.packaging = null`)

- [ ] **Step 1: Integration tests:** packaged entry stores `packaging_id`, `package_count`, quantity 3.8, unit cost 11.842105; raw insert with only one of the two columns fails the check; PATCH product leaving out a packaging with lots → 409 and nothing written.
- [ ] **Step 2: `npm run openapi:dump`; `npm run typecheck`** — clean. Integration tests not run (no Postgres).

---

### Task 7: Targeted verification

- [ ] `npm test`, `npm run typecheck`, `npx eslint src/features/entries src/server/modules/entries src/server/modules/products src/shared`, `npx prettier --check` on changed files — paste outputs.
- [ ] Comment progress on issue #28.
