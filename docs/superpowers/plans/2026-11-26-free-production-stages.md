# Free Production Stages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Starting a production without a pre-weighing brings the needed intermediates in as stage items, with how much to make of each chosen on the start screen.

**Architecture:** The free start plans each item with the pre-weighing planner (stages on, a `produce` map) and flattens the plan tree into items. The start screen shows that tree with editable "A fabricar" fields, reusing the pre-weighing stage view without weighing fields.

**Tech Stack:** Next.js App Router, Prisma 6 / Postgres, zod v4, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-26-free-production-stages-design.md`

## Global Constraints

- Code, identifiers, comments, tests in English; screen texts in pt-BR.
- Business rules in `service`; routes and actions are adapters; `schemas` never import `@prisma/client`; front types via `import type` from `src/lib/api.ts`; factories in `src/tests/samples.ts`.
- TDD: each test runs red first; paste the red output in the report.
- **Do not commit.** Do not change git state. Never edit a deployed migration (none needed).
- Integration tests on schema `test`; never read `.env*`.
- A schema change regenerates `openapi.json` (`npm run openapi:dump`) and the routes snapshot (`npx vitest run src/server/routes.test.ts -u`).
- Every touched file stays prettier-clean (the pre-commit hook runs `prettier --check .`).

## Review Focus

1. A `produce` value of 0 makes no stage item and the product still concludes from stock (Task 1).
2. A `produce` SKU listed twice → 400 (Task 1).
3. "Iniciar produção" right after editing "A fabricar", before the re-plan returns, must not start with a stale tree — the button waits for the re-plan (Task 2).
4. An item whose re-plan fails keeps its last good plan and blocks starting until fixed (Task 2).
5. Removing a free item drops its intermediates from the start body (Task 2).

---

### Task 1: Server — free start brings its intermediates

**Files:**
- Modify: `src/server/modules/productions/productions.schemas.ts`, `productions.service.ts` (`freeItem` → items), `productions.routes.integration.test.ts`, `src/lib/api.ts`, `openapi.json`, routes snapshot

**Interfaces:**
- Produces: `freeItemSchema = z.strictObject({ productSku: z.uuid(), quantity: positiveDecimalSchema, produce: z.array(z.strictObject({ productSku: z.uuid(), quantity: decimalSchema })).optional() })` refined so each `produce` SKU appears once (case-insensitive); `addProductionItemBodySchema` stays `{ productSku, quantity }` (strip `produce` for it — keep its own schema).
- `freeItems(request): Promise<Result<PlannedProductionItem[], 404 | 409>>` — `planPreWeighing(productSku, quantity, produceMap)` with stages on (lower-case SKU keys, `Prisma.Decimal` values); returns the root item then every non-null `manufactured.stage`, depth-first, each `{ productSku, preWeighingId: null, expectedQuantity: stage.quantity, inputs: stage.items → { productSku, quantity: plannedQuantity } }`.

- [ ] **Step 1: Integration tests** — the spec's list (default 3 items with recheio 0.7 and casquinha 50; recheio 1; recheio 0 → 2 items; two-level chain; 2.5 on a UNIT intermediate → 409 TOO_MANY_PLACES; duplicate produce SKU → 400; the bombom's `dependsOn` names its stage items).
- [ ] **Step 2: Red, implement, green** — `npm run test:integration -- src/server/modules/productions`, `npm test`, tsc; openapi + snapshot.

### Task 2: Client — "A fabricar" on the free start screen

**Files:**
- Modify: `src/features/productions/actions.ts` (`planProductionItem(target, produce?: Record<string, string>)`), `src/features/pre-weighings/PreWeighingStage.tsx` (`weighing` optional: no weighing column or fields when absent), `src/features/productions/StartProductionPage.tsx` (+ test), `src/features/pre-weighings/PreWeighingPage.test.tsx` only if the stage change needs it

**Interfaces:**
- Each free item keeps `{ key, target, plan, typed: Record<sku, string>, errors, replanning }`; its card renders `PreWeighingStage` with `produce` (typed/error/change, disabled while starting) and no `weighing`; a change validates with the pre-weighing screen's `produceProblem` rule (reuse it — export it if needed) and re-plans that item after the pre-weighing screen's pause (`REPLAN_DELAY_MS`, reuse it), latest answer wins; a failed re-plan shows its message on the item and keeps the last plan.
- "Iniciar produção" is disabled while any item re-plans or has an error; it sends `{ items: [{ productSku, quantity, produce: [{ productSku, quantity: toProduce }] for every manufactured line of the plan tree (any depth) }] }`.
- The shortfall warnings stay for bought ingredients ("Estoque insuficiente: falta … de …").

- [ ] **Step 1: RTL tests** — adding the bombom shows "A fabricar de Recheio" with the plan's value; editing it re-plans with `{ [recheio]: "1" }`; start is disabled while re-planning; starting sends the plan's `produce` values (including the nested casquinha); removing the item drops it; a bought ingredient's shortfall warning still shows.
- [ ] **Step 2: Red, implement, green** — `npx vitest run src/features`, `npm test`, tsc, eslint/prettier.

### Task 3: Final verification

- [ ] `npx tsc --noEmit`; `npm test`; `npm run test:integration`; `npm run openapi:dump` leaves no diff; `npx prettier --check .`; eslint on changed files. Paste every output.
