# Product Packagings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product carries a list of packagings (content + optional GTIN), saved with the product; descriptions are upper case; `products.gtin` is gone.

**Architecture:** New `product_packagings` table owned by the `products` module. Packagings travel inside the existing product bodies and are synced by the repository in the product's transaction. Unit conversion and the GTIN check digit live in `src/shared` so the browser and the server apply the same rule.

**Tech Stack:** Next.js App Router, Prisma 6 / PostgreSQL, zod 4, react-hook-form, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-11-08-product-packagings-design.md`

## Global Constraints

- Code, tests, comments, commit text in English; UI text in Portuguese.
- No commits, no push: the user commits. Each task ends with its verification output, the tree left dirty.
- TDD: write the test, run it, paste the red output, then implement.
- Business rules only in `products.service.ts`; `route.ts` and `actions.ts` are adapters.
- `*.schemas.ts` and `src/shared/*` must not import `@prisma/client` (runtime).
- Decimals cross every boundary as strings; `content` is `Decimal(18, 6)`, validated with `decimalSchema`/`positiveDecimalSchema` from `src/shared/decimal.ts`.
- `openapi.json` is regenerated with `npm run openapi:dump`, never edited.
- Integration tests (`*.integration.test.ts`, `npm run test:integration`) need Postgres, which this WSL does not have: write them, say they were not run.

## Review Focus

1. **Swapping contents or GTINs between two stored packagings in one save** (1 kg ↔ 5 kg): sequential updates hit the unique index. Expected: a 409 with the content/GTIN message, nothing written — never a 500. Pinned in Task 4 (repository unique violation → 409).
2. **Same GTIN typed on two rows of one product**: expected 400 before any query. Pinned in Task 2.
3. **Content that does not fit after conversion** (0.0005 g on a kg product; 999999999999 kg on a g product): expected 400, never rounded. Pinned in Task 4.
4. **Two products registered at once with the same description** (race past the pre-check): expected 409, not 500. Pinned in Task 4.
5. **Lowercase/accented description through the API** ("açúcar") stored as "AÇÚCAR" and clashing with an existing "AÇÚCAR": 409. Pinned in Task 2 (transform) and Task 4 (conflict on transformed value).

---

### Task 1: Unit conversion module

**Files:**
- Create: `src/shared/units.ts`
- Test: `src/shared/units.test.ts`

**Interfaces:**
- Produces:
  - `type Dimension = "MASS" | "VOLUME" | "COUNT"`
  - `dimensionOf(unit: MeasurementUnit): Dimension`
  - `compatibleUnits(unit: MeasurementUnit): MeasurementUnit[]` — order: larger unit first (`["KILOGRAM", "GRAM"]`, `["LITER", "MILLILITER"]`, `["UNIT"]`)
  - `class IncompatibleUnitsError extends Error`
  - `convert(quantity: string, from: MeasurementUnit, to: MeasurementUnit): string` — exact, normalized (no trailing fractional zeros, no trailing `.`), never rounds
  - `readableQuantity(quantity: string, unit: MeasurementUnit): { quantity: string; unit: MeasurementUnit }`

- [ ] **Step 1: Write the failing tests**

```ts
describe("convert", () => {
  it.each([
    ["380", "GRAM", "KILOGRAM", "0.38"],
    ["1.01", "KILOGRAM", "GRAM", "1010"],
    ["250", "MILLILITER", "LITER", "0.25"],
    ["2", "LITER", "MILLILITER", "2000"],
    ["12", "UNIT", "UNIT", "12"],
    ["0.0005", "GRAM", "KILOGRAM", "0.0000005"],
  ])("%s %s → %s = %s", (quantity, from, to, expected) => expect(convert(quantity, from, to)).toBe(expected));

  it("refuses units of different dimensions", () => {
    expect(() => convert("1", "KILOGRAM", "LITER")).toThrow(IncompatibleUnitsError);
    expect(() => convert("1", "UNIT", "GRAM")).toThrow(IncompatibleUnitsError);
  });
});

it("compatibleUnits", () => {
  expect(compatibleUnits("GRAM")).toEqual(["KILOGRAM", "GRAM"]);
  expect(compatibleUnits("MILLILITER")).toEqual(["LITER", "MILLILITER"]);
  expect(compatibleUnits("UNIT")).toEqual(["UNIT"]);
});

it.each([
  ["0.38", "KILOGRAM", { quantity: "380", unit: "GRAM" }],
  ["1.5", "KILOGRAM", { quantity: "1.5", unit: "KILOGRAM" }],
  ["1010", "GRAM", { quantity: "1.01", unit: "KILOGRAM" }],
  ["500", "MILLILITER", { quantity: "500", unit: "MILLILITER" }],
  ["12", "UNIT", { quantity: "12", unit: "UNIT" }],
])("readableQuantity(%s %s)", (quantity, unit, expected) => expect(readableQuantity(quantity, unit)).toEqual(expected));
```

- [ ] **Step 2: Run `npx vitest run src/shared/units.test.ts`** — expected FAIL (module not found). Paste output.
- [ ] **Step 3: Implement `src/shared/units.ts`.** Units of a dimension differ by 10^3: convert by shifting the decimal point on the string (no float, no BigInt needed). `readableQuantity`: mass/volume ≥ 1 kg/L in the large unit, else the small one.
- [ ] **Step 4: Run the same command** — expected PASS.

---

### Task 2: Product schemas, GTIN rule in shared

**Files:**
- Move: `src/lib/gtin.ts` → `src/shared/gtin.ts`, `src/lib/gtin.test.ts` → `src/shared/gtin.test.ts` (`git mv`; update the import in `ProductDialog.tsx`)
- Modify: `src/server/modules/products/products.schemas.ts`
- Test: `src/server/modules/products/products.schemas.test.ts` (new)

**Interfaces:**
- Consumes: `hasValidCheckDigit(code: string): boolean` from `@/shared/gtin`.
- Produces (all exported from `products.schemas.ts`):
  - `packagingSchema = z.object({ id: z.uuid(), content: z.string(), gtin: z.string().nullable(), isActive: z.boolean() })`
  - `productSchema`: drops `gtin`, adds `packagings: z.array(packagingSchema)`.
  - `gtinSchema`: `/^\d{8,14}$/` + `hasValidCheckDigit`.
  - `descriptionSchema`: trim, 1–120, then `toLocaleUpperCase("pt-BR")`.
  - `createPackagingSchema = z.object({ content: positiveDecimalSchema, unit: measurementUnitSchema, gtin: gtinSchema.optional() })`
  - `updatePackagingSchema = z.object({ id: z.uuid().optional(), content: positiveDecimalSchema, unit: measurementUnitSchema, gtin: gtinSchema.nullable().optional(), isActive: z.boolean().optional() })`
  - `createProductBodySchema`: drops `gtin`, adds `packagings: z.array(createPackagingSchema).optional()`.
  - `updateProductBodySchema`: drops `gtin`, adds `packagings: z.array(updatePackagingSchema).optional()`; both lists refine "no GTIN twice" (`message: "A GTIN is listed more than once."`).
  - `PRODUCT_CONFLICTS = { description: "A product with this description already exists.", gtin: "A packaging with this GTIN already exists.", content: "The product already has a packaging with this content." } as const` — the server's 409 messages, read by the dialog to pick its Portuguese text.

- [ ] **Step 1: Write failing tests** in `products.schemas.test.ts`:
  - `createProductBodySchema.parse({ description: "  açúcar refinado ", kind: "GOODS", unit: "KILOGRAM" }).description` is `"AÇÚCAR REFINADO"`.
  - a packaging GTIN `"7891000100104"` (wrong check digit) fails; `"7891000100103"` passes.
  - two packagings with GTIN `"7891000100103"` fail with `"A GTIN is listed more than once."`; two without GTIN pass.
  - `updateProductBodySchema.parse({ gtin: "7891000100103", isActive: false })` has no `gtin` key; `updateProductBodySchema.safeParse({})` still fails with "Nothing to update.".
- [ ] **Step 2: Run `npx vitest run src/server/modules/products/products.schemas.test.ts src/shared/gtin.test.ts`** — expected FAIL. Paste.
- [ ] **Step 3: Implement** the schemas above; `git mv` the gtin files.
- [ ] **Step 4: Run the same command** — expected PASS. `npm run typecheck` will now fail in the service, repository, dialog and samples: expected, fixed by Tasks 4–7.

---

### Task 3: Prisma model and migration

**Files:**
- Modify: `prisma/schema.prisma` (model `ProductPackaging` exactly as in the spec; `Product.packagings ProductPackaging[]`; remove `Product.gtin`)
- Create: `prisma/migrations/20261108000000_add_product_packagings/migration.sql`
- Test: `prisma/tests/catalog-schema.test.ts`

- [ ] **Step 1: Update the schema test**: replace "gives a SKU at most one GTIN…" with
  - `expect(SCHEMA).not.toMatch(productField(String.raw\`gtin\s\`))`
  - a `packagingField` helper like `productField` for `model ProductPackaging`, asserting `gtin\s+String\?\s+@unique`, `content\s+Decimal\s+@db\.Decimal\(18, 6\)`, `@@unique\(\[productSku, content\]`, `@@map\("product_packagings"\)`.
  - "violates no rule of the table convention" stays and covers the new model.
- [ ] **Step 2: Run `npx vitest run prisma/tests/catalog-schema.test.ts`** — FAIL. Paste.
- [ ] **Step 3: Edit `schema.prisma`; generate the SQL without a database** (`$SCRATCH` = the session scratchpad):
  `git show origin/main:prisma/schema.prisma > $SCRATCH/old.prisma && npx prisma migrate diff --from-schema-datamodel $SCRATCH/old.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261108000000_add_product_packagings/migration.sql`.
  Then append by hand:
  - `ALTER TABLE "product_packagings" ADD CONSTRAINT "product_packagings_content_check" CHECK ("content" > 0);`
  - `UPDATE "products" SET "description" = upper("description" COLLATE "und-x-icu");` — `und-x-icu` exists in any ICU-enabled PostgreSQL ≥ 10 and upper-cases accented letters regardless of the database collation, so no collation check is needed at deploy time.
  Then `npm run db:generate`.
- [ ] **Step 4: Run the schema test** — PASS. The migration itself is not applied here (no Postgres); say so.

---

### Task 4: Repository and service

**Files:**
- Create: `src/server/lib/prisma-errors.ts` — `isUniqueViolation(error: unknown): boolean` moved out of `productions.service.ts:95` (which then imports it)
- Modify: `src/server/modules/products/products.repository.ts`, `products.service.ts`
- Test: `src/server/modules/products/products.service.test.ts` (new; repository mocked with `vi.hoisted` + `vi.mock("./products.repository")`, same pattern as `pricing.service.test.ts`)

**Interfaces:**
- Consumes: Task 1 `convert`, `IncompatibleUnitsError`; Task 2 schemas and `PRODUCT_CONFLICTS`; `decimalSchema`.
- Produces (repository):
  - `type PackagingWrite = { id?: string; content: string; gtin: string | null; isActive: boolean }`
  - `findProductBySku(sku)` / `findProductByDescription(d)` → product with `packagings` (ordered by content asc, `content` as string), or null
  - `findPackagingByGtin(gtin: string): Promise<{ id: string; productSku: string } | null>`
  - `insertProduct(input: { description; kind; unit; minimumQuantity?: string; packagings: { content: string; gtin: string | null }[] })`
  - `updateProduct(sku, changes: { description?; isActive?; minimumQuantity?: string | null; packagings?: PackagingWrite[] })` — in the transaction: delete stored packagings whose id is not in the list, update those with id, create those without
  - `listProducts(filters)` — `q` also matches `EXISTS (SELECT 1 FROM product_packagings p WHERE p.product_sku = products.sku AND p.gtin LIKE ${pattern})`
- Produces (service): `createProduct(input): Result<Product, 400 | 409>`, `editProduct(sku, changes): Result<Product, 400 | 404 | 409>`.

- [ ] **Step 1: Write failing service tests:**
  1. `createProduct` with `{ description: "AÇÚCAR", unit: "KILOGRAM", packagings: [{ content: "380", unit: "GRAM" }] }` calls `insertProduct` with `packagings: [{ content: "0.38", gtin: null }]`.
  2. Packaging `{ content: "1", unit: "LITER" }` on a `KILOGRAM` product → `{ ok: false, status: 400 }`, `insertProduct` not called.
  3. `{ content: "0.0005", unit: "GRAM" }` on a `KILOGRAM` product → 400 (does not fit `decimalSchema`).
  4. `[{ content: "1000", unit: "GRAM" }, { content: "1", unit: "KILOGRAM" }]` → 409 `PRODUCT_CONFLICTS.content`.
  5. `findPackagingByGtin` answers a packaging of another sku → 409 `PRODUCT_CONFLICTS.gtin`; of the same sku (edit) → allowed.
  6. `findProductByDescription` answers another product → 409 `PRODUCT_CONFLICTS.description`.
  7. `editProduct` with `packagings: [{ id: <id not among the product's>, … }]` → 404 `"Packaging not found."`.
  8. `editProduct` passes `PackagingWrite[]` with converted contents and `isActive` defaulted to the stored value (new rows `true`).
  9. `insertProduct`/`updateProduct` rejecting with a Prisma `P2002` → 409 (Review Focus 1, 4); for `editProduct` the message is `PRODUCT_CONFLICTS.content` when the error's `meta.target` names `content`, `PRODUCT_CONFLICTS.gtin` for `gtin`, else `PRODUCT_CONFLICTS.description`.
- [ ] **Step 2: Run `npx vitest run src/server/modules/products/products.service.test.ts`** — FAIL. Paste.
- [ ] **Step 3: Implement** repository and service. Order of checks in the service: product exists (edit) → convert each packaging (400) → duplicate contents in the list (409) → description conflict → each GTIN conflict → write, catching `isUniqueViolation`.
- [ ] **Step 4: Run the test** — PASS. Run `npx vitest run src/server/modules/productions` to show the moved helper broke nothing.

---

### Task 5: REST, actions, contract

**Files:**
- Modify: `src/app/v1/products/route.ts`, `src/app/v1/products/[sku]/route.ts` (summaries mention packagings; add `400: messageSchema` to responses), `src/features/products/actions.ts` (unchanged logic; types follow), `src/tests/samples.ts` (`aProduct`: drop `gtin`, add `packagings: []`; add `aPackaging(over)`), `openapi.json` (regenerated)
- Modify: `src/server/modules/products/products.routes.integration.test.ts`

- [ ] **Step 1: Rewrite the integration tests' GTIN cases** for packagings: create with a packaging GTIN; 409 for a GTIN already in another product's packaging; 400 for a wrong check digit; PATCH sync (update by id, create, delete missing); search `q` by part of a packaging GTIN; description stored upper case.
- [ ] **Step 2: Run `npm run openapi:dump` and `npm run typecheck`.** Expected: typecheck fails only in `ProductDialog.tsx` / `ProductsListPage.tsx` (Tasks 6–7). Integration tests are not run (no Postgres): say so.

---

### Task 6: Product dialog

**Files:**
- Create: `src/features/products/PackagingFields.tsx` — the "Embalagens" section, rendered by the dialog (keeps the dialog file focused)
- Modify: `src/features/products/ProductDialog.tsx`
- Test: `src/features/products/ProductDialog.test.tsx`

**Interfaces:**
- Consumes: `compatibleUnits`, `readableQuantity`, `convert` (Task 1); `hasValidCheckDigit` (Task 2); `PRODUCT_CONFLICTS` (Task 2); `unitLabel` from `@/lib/units`.
- Form row shape: `{ id?: string; content: string; unit: MeasurementUnit; gtin: string; isActive: boolean }`.

- [ ] **Step 1: Write failing RTL tests** (replace the GTIN-field ones):
  1. Typing "açúcar" in "Descrição" shows "AÇÚCAR".
  2. "Adicionar embalagem" is disabled until "Unidade" is chosen; after choosing "Quilograma (kg)" the row's unit select offers exactly "kg" and "g".
  3. Filling content "380", unit "g", GTIN "7891000100103" and saving calls `createProduct` with `packagings: [{ content: "380", unit: "GRAM", gtin: "7891000100103" }]`; an empty GTIN is omitted.
  4. A GTIN with a wrong check digit shows "O dígito verificador do GTIN não confere. Revise o código." and does not call the action.
  5. Editing `aProduct({ packagings: [aPackaging({ content: "0.38" })] })` shows "380" with "g"; "Inativar" then saving sends that row with `id` and `isActive: false`; a new row shows "Remover" instead.
  6. 409 with each `PRODUCT_CONFLICTS` message shows respectively "Já existe um produto com essa descrição.", "Esse GTIN já está em outra embalagem.", "O produto já tem uma embalagem com esse conteúdo.".
- [ ] **Step 2: Run `npx vitest run src/features/products/ProductDialog.test.tsx`** — FAIL. Paste.
- [ ] **Step 3: Implement.** Description: `onChange` sets `value.toLocaleUpperCase("pt-BR")`. Rows with `useFieldArray`; stored rows start from `readableQuantity`. Submit sends content/unit as typed (`toApiDecimal`) — the server converts. 409 text picked by `result.message` against `PRODUCT_CONFLICTS`; other statuses keep `messageForFailure`.
- [ ] **Step 4: Run the test** — PASS.

---

### Task 7: Products list column

**Files:**
- Modify: `src/features/products/ProductsListPage.tsx`
- Test: `src/features/products/ProductsListPage.test.tsx`

- [ ] **Step 1: Failing test:** a product with active packagings `0.38` and `1` (kg) and an inactive `5` shows "380 g · 1 kg" in the "Embalagens" column; a product with none shows "—"; there is no "GTIN" column header.
- [ ] **Step 2: Run `npx vitest run src/features/products/ProductsListPage.test.tsx`** — FAIL. Paste.
- [ ] **Step 3: Implement** the column with `readableQuantity` + `quantityOf` from `@/features/stock/stock-format`; `NOTHING` when empty.
- [ ] **Step 4: Run the test** — PASS.

---

### Task 8: Targeted verification

- [ ] Run and paste: `npm test`, `npm run typecheck`, `npm run lint:eslint:check`, `npx prettier --check` on the touched files.
- [ ] State that `npm run test:integration` and the migration were not run (no Postgres in WSL).
- [ ] Comment progress on issue #27.
