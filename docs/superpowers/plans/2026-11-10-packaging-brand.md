# Packaging Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product becomes the commodity and each of its packagings carries a brand, so a recipe takes any brand of an ingredient.

**Architecture:** `ProductPackaging` gains a required `brand`; uniqueness moves to `[productSku, brand, content]`. The products module reads, writes and validates it; entries and stock responses expose it on each lot's packaging and on the packaging price history; the client shows it through one label function. Recipes, pre-weighing and production do not change.

**Tech Stack:** Next.js App Router, Prisma/Postgres, zod, Vitest (jsdom + node + integration), React Hook Form, RTL.

**Spec:** `docs/superpowers/specs/2026-11-09-packaging-brand-design.md`

## Global Constraints

- Code, tests, comments and identifiers in English; UI copy in Portuguese.
- No commits: the user's rule is that nothing is committed without an explicit order. Each task ends with its verification output; the tree stays dirty on `feat/packaging-brand`.
- TDD: paste the red output of each new test before writing the implementation.
- Brand: trimmed, `normalize("NFC")`, `toLocaleUpperCase("pt-BR")`, 1 to 60 characters, required on create and update.
- Unique index name: `uq_product_packagings_product_sku_brand_content`. GTIN stays globally unique.
- Brand is editable on a packaging with lots; content stays locked (`PRODUCT_CONFLICTS.contentLocked`).
- Placeholder brand for rows existing at migration time: `SEM MARCA`.
- 409 message: `"The product already has a packaging of this brand with this content."`; UI copy: `"O produto já tem uma embalagem dessa marca com esse conteúdo."`
- Label format: `"<BRAND> <packagingOf(content, unit)>"`, e.g. `"MOÇA 395 g"`.
- Integration tests run with `npm run test:integration` only after confirming the Prisma log says `schema "test"`; the setup truncates every table.
- `openapi.json` is regenerated with `npm run openapi:dump`, never edited by hand.

## Review Focus

- **Same content typed in two units under one brand** (`MOÇA 395 g` and `MOÇA 0,395 kg`) must be refused as a duplicate, by the form and by the server — tests in Task 2 (service) and Task 4 (form).
- **Brand typed with different case/accents encoding** (`moça` vs `MOÇA`, decomposed `ç`) is one brand: duplicate refused — tests in Task 1 (schema) and Task 2 (service).
- **Renaming a brand with lots while another packaging of the list takes the old pair** (MOÇA 395 g → ITALAC, new row MOÇA 395 g) must save, not hit the unique index — test in Task 2 (`planPackagingSync`).
- **Blank brand made of spaces** is refused, not stored as `""` — test in Task 1.
- **A lot whose packaging was renamed** shows the new spelling in entries and stock — integration test in Task 3.

---

### Task 1: Brand schema and shared normalizer

**Files:**
- Modify: `src/server/modules/products/products.schemas.ts`
- Test: `src/server/modules/products/products.schemas.test.ts`

**Interfaces:**
- Produces: `brandSchema` (zod string → normalized string), exported from `products.schemas.ts`; `packagingSchema` with `brand: z.string()`; `createPackagingSchema` and `updatePackagingSchema` with `brand: brandSchema`; `PRODUCT_CONFLICTS.brandAndContent` (replaces `PRODUCT_CONFLICTS.content`) = the 409 message from Global Constraints.

- [ ] **Step 1: Write the failing tests** in `describe("packaging brand")`:
  - `"is trimmed and upper-cased, accents included"`: `createPackagingSchema.parse({ content: "395", unit: "GRAM", brand: "  moça " }).brand` → `"MOÇA"`.
  - `"writes one brand one way, however its accents were encoded"`: brand `"moça"` parses to `"MOÇA"` (NFC, 4 code units).
  - `"is required"`: `createPackagingSchema.safeParse({ content: "395", unit: "GRAM" }).success` → `false`; same for `updatePackagingSchema`.
  - `"refuses a blank brand"`: brand `"   "` → `success: false`.
  - `"refuses a brand longer than 60 characters"`: `"A".repeat(61)` → false; `"A".repeat(60)` → true.
  - Existing packaging test fixtures in this file gain `brand: "MOÇA"` so they keep passing.
- [ ] **Step 2: Run** `npx vitest run --project api src/server/modules/products/products.schemas.test.ts` — expect the new tests to FAIL (brand stripped/undefined). Paste output.
- [ ] **Step 3: Implement.** Extract `normalizedNameSchema(max: number)` (trim → min 1 → max → NFC + pt-BR upper case) in `products.schemas.ts`; `descriptionSchema = normalizedNameSchema(120)`, `brandSchema = normalizedNameSchema(60)`. Add `brand` to the three packaging schemas; rename the conflict key to `brandAndContent` with the new message.
- [ ] **Step 4: Run** the same command — PASS. Then `npm run typecheck` — the errors left are the callers of `PRODUCT_CONFLICTS.content` and the missing `brand` in writes; they are fixed in Task 2 (note them, do not fix here).

### Task 2: Data, repository, service and sync of products

**Files:**
- Modify: `prisma/schema.prisma` (`ProductPackaging`)
- Create: `prisma/migrations/20261110000000_add_product_packaging_brand/migration.sql`
- Modify: `src/server/modules/products/products.repository.ts` (`PRODUCT_FIELDS` select + `orderBy`, `PackagingWrite`, `insertProduct`, `syncPackagings`)
- Modify: `src/server/modules/products/products.service.ts` (`contentsIn` duplicate check, writes, `conflictOfViolation`)
- Modify: `src/server/modules/products/packaging-sync.ts`
- Modify: `src/features/products/ProductDialog.tsx:71` (conflict key rename only)
- Test: `src/server/modules/products/products.service.test.ts`, `src/server/modules/products/packaging-sync.test.ts`, `src/server/modules/products/products.routes.integration.test.ts`
- Regenerate: `openapi.json`

**Interfaces:**
- Consumes: Task 1 schemas and `PRODUCT_CONFLICTS.brandAndContent`.
- Produces: `PackagingWrite = { id?: string; brand: string; content: string; gtin: string | null; isActive: boolean }`; `planPackagingSync(stored: { id; brand; content; gtin }[], writes: PackagingWrite[])`; products answer `packagings[].brand`, ordered by `brand asc, content asc`.

- [ ] **Step 1: Write the failing tests.**
  - `packaging-sync.test.ts`: `stored`/`write` helpers gain a `brand` argument (default `"MOÇA"`). New tests:
    - `"changes a packaging only after the one holding its new brand and content has moved away"`: stored `BAG (MOÇA, 395)`, `SACK (ITALAC, 395)`; writes `BAG → ITALAC 395`, `SACK → PIRACANJUBA 395` → `updates` ids `[SACK, BAG]`.
    - `"lets the same content under different brands be written in any order"`: stored `BAG (MOÇA, 395)`, `SACK (ITALAC, 1)`; writes `BAG → MOÇA 395`, `SACK → ITALAC 395` → `updates` ids `[BAG, SACK]` (list order kept).
    - `"renames a brand while a new packaging takes the old pair"`: stored `BAG (MOÇA, 395)`; writes `BAG → ITALAC 395`, new `MOÇA 395` → `updates` `[BAG → ITALAC]`, `creates` `[MOÇA 395]`.
  - `products.service.test.ts`: `SUGAR.packagings` gain brands; request bodies gain `brand`. New/changed tests:
    - `"refuses two packagings of one brand that hold the same content"` (rename of the existing content test): `[{ brand: "moça", content: "395", unit: "GRAM" }, { brand: "MOÇA", content: "0.395", unit: "KILOGRAM" }]` on a KILOGRAM product → `{ ok: false, status: 409, error: PRODUCT_CONFLICTS.brandAndContent }`, `insertProduct` not called.
    - `"takes the same content under two brands"`: `MOÇA 395 g` + `ITALAC 395 g` → `insertProduct` called with packagings `[{ brand: "MOÇA", content: "0.395", ... }, { brand: "ITALAC", content: "0.395", ... }]`.
    - `"lets the brand of a packaging stock lots came in be corrected"`: `findPackagingsWithLots → [BAG_ID]`; edit `BAG_ID` brand `"MOCA"` → `"MOÇA"` same content → `updateProduct` called with that brand, result ok.
    - `"answers 409 when a concurrent save takes the brand and content first"`: `insertProduct` rejects `uniqueViolation(["product_sku", "brand", "content"])` → 409 `brandAndContent`.
  - `products.routes.integration.test.ts`: `"keeps one product with the same content under two brands"` (POST two brands at 395 g → 201, GET answers both with brands ordered `ITALAC`, `MOÇA`); `"refuses the same brand and content twice"` → 409. Existing request bodies with packagings gain `brand`.
- [ ] **Step 2: Run** `npx vitest run --project api src/server/modules/products` — new tests FAIL. Paste output.
- [ ] **Step 3: Schema + migration.** `brand String` on `ProductPackaging`; replace `@@unique([productSku, content], ...)` with `@@unique([productSku, brand, content], map: "uq_product_packagings_product_sku_brand_content")`. Migration SQL, in order: `ALTER TABLE "product_packagings" ADD COLUMN "brand" TEXT NOT NULL DEFAULT 'SEM MARCA'`; `ALTER ... ALTER COLUMN "brand" DROP DEFAULT`; `DROP INDEX "uq_product_packagings_product_sku_content"`; `CREATE UNIQUE INDEX "uq_product_packagings_product_sku_brand_content" ON "product_packagings"("product_sku", "brand", "content")`. Apply with `npm run db:migrate:dev` (dev schema) and `npm run db:generate`.
- [ ] **Step 4: Implement.**
  - `contentsIn` keeps converting contents; the duplicate check moves to pairs `brand + "\u0000" + content` and answers `brandAndContent`.
  - Writes carry `brand` (create and edit). Brand is never compared to the stored one for locking.
  - `conflictOfViolation`: a target containing `"content"` answers `brandAndContent`.
  - `planPackagingSync`: `holds(other, pair)` compares `(byId.get(other.id).brand, normalizeDecimal(content))` to the write's `(brand, normalizeDecimal(content))`.
  - Repository: select and write `brand`; `orderBy: [{ brand: "asc" }, { content: "asc" }]`; `syncPackagings` reads `brand` of the stored rows.
  - `ProductDialog.tsx:71`: key `PRODUCT_CONFLICTS.brandAndContent`, copy from Global Constraints.
- [ ] **Step 5: Verify.** `npx vitest run --project api src/server/modules/products` — PASS. Confirm `schema "test"` then `npx vitest run --project integration src/server/modules/products` — PASS. `npm run openapi:dump`. Paste outputs. (Typecheck errors left are in entries/stock/client: Tasks 3–5.)

### Task 3: Brand on lot packagings and packaging price history

**Files:**
- Modify: `src/server/modules/stock/stock.schemas.ts` (extract `lotPackagingSchema`; `packagings[]` gains `brand`; comment "ordered by brand, then content")
- Modify: `src/server/modules/entries/entries.schemas.ts:64` (use `lotPackagingSchema`)
- Create: `src/server/modules/stock/stock.lot-packaging.ts` + `stock.lot-packaging.test.ts`
- Modify: `src/server/modules/entries/entries.service.ts:107-117`, `src/server/modules/stock/stock.service.ts:90-98` (use `lotPackagingOf`)
- Modify: `src/server/modules/stock/stock.repository.ts:129,367,371-374` (select `brand`)
- Modify: `src/server/modules/stock/stock.packaging-costs.ts` + its test
- Test: `src/server/modules/entries/entries.routes.integration.test.ts`, `src/server/modules/stock/stock.routes.integration.test.ts`
- Regenerate: `openapi.json`

**Interfaces:**
- Produces: `lotPackagingSchema = z.object({ id: z.uuid(), brand: z.string(), content: z.string(), count: z.number().int(), price: z.string() }).nullable()`; `lotPackagingOf(lot: { packaging: { id: string; brand: string; content: Prisma.Decimal } | null; packageCount: number | null; packagePrice: Prisma.Decimal | null }): z.output<typeof lotPackagingSchema>`; `packagingCostsOf` items gain `brand: string`, sorted by brand then content.

- [ ] **Step 1: Write the failing tests.**
  - `stock.lot-packaging.test.ts`: `"answers the packaging with its brand, content, count and price"` (`{ id, brand: "MOÇA", content: "0.395", count: 12, price: "6.49" }`); `"answers null for a lot received loose"` (any of the three null → `null`).
  - `stock.packaging-costs.test.ts`: `"tells each packaging's brand"`; `"orders by brand, then content"` (`ITALAC 1`, `MOÇA 0.395`, `MOÇA 1` from shuffled input).
  - Integration: entry by packaging answers `lot.packaging.brand`; stock product answers `lots[].packaging.brand` and `packagings[].brand`; `"shows the corrected brand on lots that came in the packaging"` (enter a lot, rename the packaging brand via product PATCH, GET stock product → new brand on the lot).
- [ ] **Step 2: Run** `npx vitest run --project api src/server/modules/stock` — FAIL. Paste output.
- [ ] **Step 3: Implement** per the Interfaces block; both services call `lotPackagingOf`, both schemas use `lotPackagingSchema`.
- [ ] **Step 4: Verify.** `npx vitest run --project api src/server/modules/stock src/server/modules/entries` — PASS. Confirm `schema "test"`, then `npx vitest run --project integration src/server/modules/stock src/server/modules/entries` — PASS. `npm run openapi:dump`. Paste outputs.

### Task 4: Brand in the product register

**Files:**
- Modify: `src/features/stock/stock-format.ts` (+ `stock-format.test.ts`)
- Modify: `src/features/products/PackagingFields.tsx`
- Modify: `src/features/products/ProductsListPage.tsx:48`
- Modify: `src/tests/samples.ts` (`aPackaging`, `aStockLot`/entry lot packaging, `aPackagingCost` gain `brand: "MOÇA"`)
- Test: `src/features/products/ProductDialog.test.tsx`, `src/features/products/ProductsListPage.test.tsx`

**Interfaces:**
- Consumes: `Packaging.brand` from `src/lib/api.ts` (inferred, no edit needed).
- Produces: `packagingLabel(brand: string, content: string, unit: MeasurementUnit): string` in `stock-format.ts`; `PackagingRow` gains `brand: string`.

- [ ] **Step 1: Write the failing tests.**
  - `stock-format.test.ts`: `packagingLabel("MOÇA", "0.395", "KILOGRAM")` → `"MOÇA 395 g"`.
  - `ProductDialog.test.tsx`: `"sends the brand of each packaging"` (types `moça` in "Marca", input shows `MOÇA`, action called with `packagings: [{ brand: "MOÇA", ... }]`); `"asks for the brand of a packaging"` (blank → `"Informe a marca da embalagem."`, action not called); `"refuses the same brand and content twice"` (`MOÇA 395 g` and `MOÇA 0,395 kg` → `"Cada marca só pode ter uma embalagem com esse conteúdo."`, action not called); `"shows the brand of a stored packaging"`; the server-409 test uses the new copy.
  - `ProductsListPage.test.tsx`: packaging summary reads `"ITALAC 1 kg · MOÇA 395 g"`.
- [ ] **Step 2: Run** `npx vitest run --project web src/features/products src/features/stock/stock-format.test.ts` — FAIL. Paste output.
- [ ] **Step 3: Implement.** `packagingLabel` = `` `${brand} ${packagingOf(content, unit)}` ``. Row schema gains `brand` (trim, required, max 60, upper-cased as typed like the description input). `packagingRowsSchema` gains a refine keyed on `brand.trim().toLocaleUpperCase("pt-BR")` + content converted to the first row's unit with `convert` from `@/shared/units` (rows whose content does not parse are skipped). `rowOf`, `toCreatedPackaging`, `toEditedPackaging` carry `brand`. Summary in `ProductsListPage` uses `packagingLabel`.
- [ ] **Step 4: Verify.** Same command — PASS. Paste output.

### Task 5: Brand on the entry and stock screens

**Files:**
- Modify: `src/features/entries/EntryPage.tsx:133,312-314`
- Modify: `src/features/stock/StockProductPage.tsx:113`
- Modify: `src/features/stock/PackagingCostsSection.tsx:49,98`
- Test: `src/features/entries/EntryPage.test.tsx`, `src/features/stock/StockProductPage.test.tsx`, `src/features/stock/PackagingCostsSection.test.tsx`

**Interfaces:**
- Consumes: `packagingLabel` (Task 4); `lot.packaging.brand`, `PackagingCost.brand` (Task 3, via `src/lib/api.ts` inference).

- [ ] **Step 1: Write the failing tests.**
  - `EntryPage.test.tsx`: packaging select offers `"MOÇA 395 g"` and `"ITALAC 395 g"` for one product; recorded entry reads `"12 × MOÇA 395 g (4,74 kg)"`.
  - `StockProductPage.test.tsx`: lot row reads `"12 × MOÇA 395 g"`.
  - `PackagingCostsSection.test.tsx`: rows read `"ITALAC 395 g"` and `"MOÇA 395 g"`; history dialog title `"Entradas de MOÇA 395 g"`.
- [ ] **Step 2: Run** `npx vitest run --project web src/features/entries src/features/stock` — FAIL. Paste output.
- [ ] **Step 3: Implement** by replacing `packagingOf(content, unit)` with `packagingLabel(brand, content, unit)` at the listed lines.
- [ ] **Step 4: Verify.** Same command — PASS. Then the targeted gate for everything touched: `npm test`, `npm run typecheck`, `npm run lint:eslint:check`, `npm run lint:prettier:check`, and (after confirming `schema "test"`) `npx vitest run --project integration src/server/modules/products src/server/modules/entries src/server/modules/stock`. Paste outputs.
