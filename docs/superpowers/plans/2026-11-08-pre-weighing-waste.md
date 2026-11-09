# Pre-weighing waste suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark products that cannot be kept once opened and suggest pre-weighing quantities, within a tolerance, that lose less money in leftovers of those ingredients.

**Architecture:** A product flag (`isStorableOnceOpened`); a pure `suggestQuantities` in `pre-weighings.plan.ts`; `previewPreWeighing` feeds it from the recipe, the first suggested lot's packaging and the average cost, and returns `waste` with the plan; the screen adds a tolerance field and a "Sobras de abertos" section.

**Tech Stack:** Next.js App Router, Prisma 6 / PostgreSQL, zod 4, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-11-08-pre-weighing-waste-design.md`

## Global Constraints

- UI text in Portuguese; code in English. `*.schemas.ts` without runtime `@prisma/client`.
- Exact decimals only (`Prisma.Decimal` on the server, strings on the client); no float in the rule.
- Losses in R$ with 2 places half up; leftovers shown with `weighedOf` (3 places, readable unit).
- `openapi.json` via `npm run openapi:dump`. No Postgres locally: integration tests written, run in CI.
- TDD, red output seen before each implementation. No commits without the user's order.

## Review Focus

- `recipeQuantity` of 0 is impossible (recipes refuse it) but a `content` of an ingredient lot equal to 0 is impossible too (positive check) — `suggestQuantities` must not divide by zero if an input slips through: guard returns no candidates for that ingredient. Pinned in Task 2.
- Tolerance 100 on a large Q with a tiny packaging creates many candidates (k up to thousands): cap k so the work stays bounded (at most 1000 candidates per ingredient). Pinned in Task 2.
- A candidate rounding below Q (rounding down) is dropped; Q itself is always the requested line. Pinned in Task 2.
- The `FOR UPDATE` lot query must keep working after the packaging column is read (no outer join on the locked side). Pinned in Task 3 by keeping `takeFromLots` integration tests green.
- A plan recalculated by "Produzir 10,533 kg" must send that exact quantity and keep the tolerance typed. Pinned in Task 4.

---

### Task 1: `isStorableOnceOpened` on products

**Files:** `prisma/schema.prisma`, migration `prisma/migrations/20261108300000_add_product_is_storable_once_opened/migration.sql`, `prisma/tests/catalog-schema.test.ts` (or the products schema test that exists), `src/server/modules/products/products.schemas.ts`, `products.repository.ts`, `products.service.test.ts`, `products.routes.integration.test.ts`, `src/features/products/ProductDialog.tsx`, `ProductDialog.test.tsx`, `src/tests/samples.ts`, `openapi.json`.

**Produces:** `Product.isStorableOnceOpened: boolean` (response), optional in create/update bodies; `aProduct()` has `isStorableOnceOpened: true`.

- [ ] Failing tests: schema test matches `isStorableOnceOpened\s+Boolean\s+@default\(true\) @map\("is_storable_once_opened"\)`; `createProductBodySchema.parse({...})` yields `isStorableOnceOpened: true` when omitted; dialog shows checkbox "Pode ser guardado depois de aberto" checked by default, unchecking sends `isStorableOnceOpened: false` on create and on edit; editing a product with `false` starts unchecked.
- [ ] Run `npx vitest run --project api --project web prisma/tests src/server/modules/products src/features/products` — FAIL.
- [ ] Implement: field + migration from `prisma migrate diff` (old schema from `git show main:prisma/schema.prisma`); schemas (`z.boolean().default(true)` on create, `.optional()` on update, `z.boolean()` in the product schema); `PRODUCT_FIELDS` selects it; dialog checkbox via `Checkbox` + `Controller`; `openapi:dump`.
- [ ] Run the same command and `npx tsc --noEmit` — PASS.

### Task 2: `suggestQuantities`

**Files:** `src/server/modules/pre-weighings/pre-weighings.plan.ts`, `pre-weighings.plan.test.ts`.

**Produces:** the `suggestQuantities`, `WasteIngredient` and `Suggestion` exactly as the spec's Calculation section types them (exported).

- [ ] Failing tests — the spec's tests 1–5 with its numbers, plus:
  - `content` 0 for an ingredient → it adds no candidate and leaves nothing (no throw);
  - Q 1000 kg, tolerance 100, content 1 g, 1 g per kg → finishes and returns ≤ 3 alternatives (bounded k);
  - every alternative's quantity is > Q and ≤ Q × (1 + tolerance/100).
- [ ] Run `npx vitest run --project api src/server/modules/pre-weighings/pre-weighings.plan.test.ts` — FAIL.
- [ ] Implement. `k` runs from `⌈need(Q)/content⌉` to `⌊need(Qmax)/content⌋`, at most 1000 values. Rounding with `toDecimalPlaces(places, ROUND_DOWN | ROUND_UP)`, places 0 for UNIT, 3 otherwise. Sort by loss, then quantity; dedupe by quantity string; filter loss < requested loss; take 3.
- [ ] Run — PASS.

### Task 3: `waste` in the plan

**Files:** `src/server/modules/stock/stock.repository.ts` (`UsableLot`, `usableLots`), `src/server/modules/pre-weighings/pre-weighings.repository.ts` (`findProductWithRecipe`), `pre-weighings.service.ts`, `pre-weighings.schemas.ts`, `src/features/pre-weighings/actions.ts`, `src/app/v1/pre-weighings/plan/route.ts` (if it lists query fields), `pre-weighings.routes.integration.test.ts`, `src/lib/api.ts`, `src/tests/samples.ts`, `openapi.json`.
- Create: `src/server/modules/pre-weighings/pre-weighings.service.test.ts` (repository and `suggestLots` mocked).

**Consumes:** Task 1 flag, Task 2 function. **Produces:** `previewPreWeighing(productSku, quantity, tolerance = 20)`; `preWeighingPlanSchema.waste` as the spec writes it (decimals as strings); `PreWeighingTarget` unchanged and a separate `tolerance` argument to the `planPreWeighing` action: `planPreWeighing(target, tolerance)`; `aPreWeighingPlan()` has `waste: null`; type `PreWeighingWaste` exported from `src/lib/api.ts`.

- [ ] Failing tests (service, mocked):
  - no non-keeping ingredient → `waste: null`;
  - a non-keeping ingredient whose first suggested lot has `packageContent` → counted, numbers of spec test 2 as strings (`"3.2"` loss → written `"3.20"` with 2 places), alternatives present;
  - first lot loose (`packageContent: null`) or no lot → in `unpackaged`, not counted;
  - counted ingredient with no average cost → in `uncosted`, leftover with `loss: null`;
  - `preWeighingPlanQuerySchema` refuses tolerance 101, −1, 1.5; defaults to 20.
- [ ] Run `npx vitest run --project api src/server/modules/pre-weighings` — FAIL.
- [ ] Implement:
  - `usableLots` selects `(SELECT content FROM product_packagings WHERE id = packaging_id) AS "packageContent"` (scalar subquery, so `FOR UPDATE` still applies to `stock_lots` alone); `UsableLot.packageContent: Prisma.Decimal | null`.
  - `findProductWithRecipe` ingredient product selects `isStorableOnceOpened` and `stock: { select: { averageCost: true } }`.
  - service builds `WasteIngredient[]` from the non-keeping ingredients with `takes[0]?.lot.packageContent`, calls `suggestQuantities`, presents decimals with `toString()`, losses with `toFixed(2)`.
  - integration: plan with a non-keeping ingredient in a lot with a 395 g packaging returns `waste.requested.loss "3.20"`; `takeFromLots` tests unchanged and green in CI.
  - `openapi:dump`.
- [ ] Run — PASS; `npx tsc --noEmit`.

### Task 4: "Sobras de abertos" on the pre-weighing screen

**Files:** `src/features/pre-weighings/PreWeighingPage.tsx`, `PreWeighingPage.test.tsx`; create `src/features/pre-weighings/WasteSection.tsx` if the section passes ~60 lines.

**Consumes:** Task 3 types and action signature; `weighedOf`, `formatMoney`, `quantityOf`.

- [ ] Failing tests:
  - field "Aceitar até" prefilled "20" with suffix "%"; Calcular sends `planPreWeighing({ productSku, quantity: "10" }, 20)`; "101" or "1,5" → "Informe um número inteiro de 0 a 100." and no call;
  - with `waste`: heading "Sobras de abertos"; requested line "10 kg: perda de R$ 3,20 (160 g de Leite condensado)"; alternative "10,533 kg: perda de R$ 0,00 (0,1 g de Leite condensado)" with button "Produzir 10,533 kg";
  - clicking it fills "Quantidade a produzir" with "10,533" and calls `planPreWeighing({ productSku, quantity: "10.533" }, 20)`;
  - requested with no leftovers: "10 kg: sem sobras"; no alternatives: "Nenhuma quantidade até +20% reduz as sobras.";
  - warnings "Creme de leite: sem embalagem conhecida." and "Leite condensado: sem custo médio.";
  - `waste: null` → no section.
- [ ] Run `npx vitest run --project web src/features/pre-weighings` — FAIL.
- [ ] Implement as the spec's Web section says.
- [ ] Run — PASS.

### Task 5: Verification and review

- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint src prisma` (compare warnings with main), `npx prettier --check .` — outputs pasted.
- [ ] Final whole-branch review by a fresh reviewer (opus) with the Review Focus; fix Critical/Important with TDD; minors to the ledger and #29.
- [ ] Tree left uncommitted for the user's order.
