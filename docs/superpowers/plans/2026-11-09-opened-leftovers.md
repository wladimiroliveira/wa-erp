# Opened packaging leftovers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write off, when a production finishes, what is left of the opened packagings of ingredients that cannot be kept, as an `OPENED_LEFTOVER` movement tied to the production, with the finisher choosing whether its cost goes into the cost produced.

**Architecture:** A pure `leftoverOf` rule; `takeFromLots` exposes each take's lot quantity and packaging content; `consumeProductionInput` writes the leftover off through `takeFromLot` (the losses path); `finishProduction` stores the choice and adds the cost; a preview endpoint reuses the rule over `suggestLots`; the finish form shows the preview and the checkbox.

**Tech Stack:** Next.js App Router, Prisma 6 / PostgreSQL, zod 4, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-11-09-opened-leftovers-design.md`

## Global Constraints

- UI text in Portuguese; code in English. `*.schemas.ts` without runtime `@prisma/client`.
- Booleans start with `is`/`has` (schema convention test). Exact decimals only.
- `openapi.json` via `npm run openapi:dump`. No Postgres locally: integration tests written, run in CI.
- TDD, red output seen before each implementation. No commits without the user's order.

## Review Focus

- A lot taken to zero leaves no leftover, and the write-off never takes more than the lot holds (the leftover is computed from the lot's own quantity under the same `FOR UPDATE`). Pinned in Task 1 and Task 3 (integration).
- Two inputs of the same production taking the same product (two items) each compute the leftover on the lot as it stands after their own take, not a stale quantity. Pinned in Task 3: the leftover is read from `takeFromLot`'s locked row, and an integration test finishes two items using the same non-storable product.
- An owed take (`lotId: null`) produces no leftover and no crash. Pinned in Task 3.
- `hasLeftoversInCost` omitted by an old client counts as true. Pinned in Task 3.
- A failed preview still lets the production be finished. Pinned in Task 4.

---

### Task 1: `leftoverOf`

**Files:** Create `src/server/modules/productions/production-leftovers.ts`, `production-leftovers.test.ts`.

**Produces:** `leftoverOf(lotQuantity: Prisma.Decimal, taken: Prisma.Decimal, content: Prisma.Decimal): Prisma.Decimal`.

- [ ] Failing tests: the spec's test 1 cases (95; 0; 190; 0; 0), plus `taken` greater than the lot → 0.
- [ ] Run `npx vitest run --project api src/server/modules/productions/production-leftovers.test.ts` — FAIL (module missing).
- [ ] Implement (`left.mod(content)`; guards for `content ≤ 0`, `left ≤ 0`).
- [ ] Run — PASS.

### Task 2: Schema

**Files:** `prisma/schema.prisma`, migration `prisma/migrations/20261109000000_add_production_leftovers/migration.sql`, `prisma/tests/production-schema.test.ts`, `prisma/tests/production-schema.integration.test.ts`.

**Produces:** `StockMovementType.OPENED_LEFTOVER`; `Production.hasLeftoversInCost Boolean?`; model `ProductionLeftover` exactly as the spec writes it, with back-relations `ProductionItemInput.leftovers`, `StockLot.leftovers`, `StockMovement.leftover`.

- [ ] Failing tests (schema text): the enum value, the field with `@map("has_leftovers_in_cost")`, the model with its two indexes and `@@map("production_leftovers")`; conventions test still empty. Integration: CHECKs refuse `quantity 0` and `unit_cost -1`.
- [ ] Run `npx vitest run --project api prisma/tests/production-schema.test.ts` — FAIL.
- [ ] Implement; migration from `prisma migrate diff` (old schema `git show main:prisma/schema.prisma`) plus `ck_production_leftovers_quantity_positive` and `ck_production_leftovers_unit_cost_non_negative`; `npx prisma generate`.
- [ ] Run — PASS; `npx tsc --noEmit` (exhaustive maps over `StockMovementType`, e.g. `movement-types.ts`, will fail until Task 4 — add the `OPENED_LEFTOVER` entry there now: `{ origin: "Sobra de embalagem aberta", direction: OUT }`, with its test in `StockMovementsPage.test.tsx` red first).

### Task 3: Write-off at finish, cost choice, preview

**Files:** `src/server/modules/stock/stock.repository.ts` (`takeFromLots` take shape), `src/server/modules/productions/productions.repository.ts`, `productions.service.ts`, `productions.schemas.ts`, `src/app/v1/productions/[id]/finish/route.ts`, create `src/app/v1/productions/[id]/leftovers/route.ts`, `src/server/routes.ts` (if routes are registered there), `src/features/productions/actions.ts`, create `src/server/modules/productions/productions.service.test.ts` (repository mocked) if none exists, `productions.routes.integration.test.ts`, `src/lib/api.ts`, `src/tests/samples.ts`, `openapi.json`.

**Consumes:** Task 1 `leftoverOf`, Task 2 schema. **Produces:**
- `takeFromLots` takes: `{ lotId, quantity, unitCost, lotQuantity: Decimal | null, packageContent: Decimal | null }` (nulls for the owed take).
- `consumeProductionInput(tx, { …, discardsOpened: boolean })` → `{ cost: Decimal; leftoverCost: Decimal }`.
- `previewProductionLeftovers(production)` → per item, per input, `{ product, lotId, quantity, unitCost }[]`.
- Service `previewLeftovers(id)`: `Result<{ items: { itemId; leftovers: { product; lotId; quantity; unitCost; cost }[] }[]; totalCost: string }, 404 | 409>`.
- `finishProductionBodySchema.hasLeftoversInCost: z.boolean().default(true)`; `productionSchema.hasLeftoversInCost: z.boolean().nullable()`; each input `leftovers: { lotId; quantity; unitCost }[]`.
- Action `previewLeftovers(id)`; `finishProduction` action passes the body through.
- Types `LeftoversPreview` in `src/lib/api.ts`; samples: `aProduction()` `hasLeftoversInCost: null`, inputs `leftovers: []`.

- [ ] Failing tests:
  - service (mocked repository): finish with `hasLeftoversInCost: true` and a mocked `consumeProductionInput` returning `{ cost: 3, leftoverCost: 1.9 }` for 1 produced → `outputProductionItem` with `unitCost` 4.9; with `false` → 3; omitted (schema default) → 4.9; `markProductionFinished` receives the choice; `previewLeftovers` 404 / 409.
  - schema: `finishProductionBodySchema.parse({ items })` has `hasLeftoversInCost: true`.
  - integration (CI): the spec's tests 5–7, plus two items consuming the same non-storable product (both leftovers right, lot never negative), and an owed take.
- [ ] Run `npx vitest run --project api src/server/modules/productions src/server/modules/stock` — FAIL.
- [ ] Implement:
  - `consumeProductionInput`: after `takeFromLots`, when `discardsOpened`, for each take with `lotId`, `packageContent` and `lotQuantity`: `left = leftoverOf(lotQuantity, quantity, packageContent)`; if `> 0`, `takeFromLot(tx, { lotId, quantity: left })` (already locked; also lowers the balance), create the `OPENED_LEFTOVER` movement at the lot's unit cost and the `productionLeftover` row with the input id. `leftoverCost` = Σ left × unitCost.
  - `finishProduction`: `discardsOpened = !input.product.isStorableOnceOpened` (select it in `productionSelect`); add `leftoverCost` to `inputsCost` when the choice is true; `markProductionFinished(tx, id, hasLeftoversInCost)` writes it.
  - preview: for each input of a non-storable product, `suggestLots` then `leftoverOf` per take whose lot has `packageContent`; costs `toFixed(2)`.
  - route `GET /v1/productions/{id}/leftovers` with `auth` `PRODUCTION_READ`, like `[id]/route.ts`.
  - `openapi:dump`.
- [ ] Run — PASS; `npx tsc --noEmit`.

### Task 4: Screens

**Files:** `src/features/productions/FinishProductionForm.tsx`, `FinishProductionForm.test.tsx`, `ProductionDetailPage.tsx`, `ProductionDetailPage.test.tsx`.

**Consumes:** Task 3 action and types; `weighedOf`, `formatMoney`, `readableQuantity`.

- [ ] Failing tests:
  - form: with a preview of "Leite condensado" 95 g at 0.02 → heading "Sobras que serão descartadas", "Leite condensado: 95 g (R$ 1,90)", "Total: R$ 1,90", checkbox "Incluir as sobras no custo da produção" checked; finishing sends `hasLeftoversInCost: true`, unchecked sends `false`; empty preview → no section and the body still sends `true`; preview failing → "Não foi possível calcular as sobras." and finishing still works.
  - detail: column "Sobra descartada" "95 g · R$ 1,90", "—" without; fact "Sobras no custo" "Sim"/"Não", absent while in progress.
- [ ] Run `npx vitest run --project web src/features/productions` — FAIL.
- [ ] Implement as the spec's Web section says.
- [ ] Run — PASS.

### Task 5: Verification and review

- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint src prisma` (compare with main), `npx prettier --check .` — outputs pasted.
- [ ] Final whole-branch review by a fresh reviewer (opus) with the Review Focus; fix Critical/Important with TDD; minors to the ledger and #29.
- [ ] Tree left uncommitted for the user's order.
