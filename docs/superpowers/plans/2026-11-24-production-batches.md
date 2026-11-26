# Production Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each production item is made in batches ("levas") recorded on the production screen, weighed there when more is needed, and concluded at (or, under the spec's rules, below) its target.

**Architecture:** Two new tables — batches and an item's extra weighings. Batches are progress only; concluding an item consumes its (scaled) inputs and outputs lots grouped by expiry, in one transaction holding the production row. The finish-subset and reduce endpoints and the pre-weighing screen's production mode go away; every weighing inside a production goes through one per-item endpoint.

**Tech Stack:** Next.js App Router, Prisma 6 / Postgres, zod v4, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-24-production-batches-design.md`

## Global Constraints

- Code, identifiers, comments, tests in English; screen texts in pt-BR exactly as this plan gives them; the screen word is "leva", the code word `batch`.
- Business rules in `service`; `route.ts` and actions are adapters; every route declares `auth` (reads `PRODUCTION_READ`, writes `PRODUCTION_CREATE`). `schemas` never import `@prisma/client`; front types via `import type` from `src/lib/api.ts`; factories in `src/tests/samples.ts`.
- Every write holds the production row first (`holdProduction` / `lockProductionInProgress`), as today.
- TDD: each test runs red before its implementation; paste the red output in the report.
- **Do not commit.** Do not change git state.
- Integration tests on schema `test` (`npm run test:integration`); never reset the dev database; migrations by `--create-only` (or hand-written SQL) then `npx prisma migrate deploy`.
- Never read `.env*`.
- A route or presentation change regenerates `openapi.json` (`npm run openapi:dump`) and the routes snapshot (`npx vitest run src/server/routes.test.ts -u`) in the same task.
- `src/server/modules/productions/productions.service.ts` is already large: put the batch and conclusion rules in a new `src/server/modules/productions/production-batches.service.ts` (and their pure helpers in `production-batches.ts`), importing what they need from the existing modules.

## Review Focus

1. Concluding with 25 produced + 25 existing of 50: exactly half of every input leaves stock, and the produced lot costs (what left) ÷ 25 (Task 4).
2. A batch recorded with an expiry, a second with another expiry, a third with the first's: concluding makes two lots, quantities summed per expiry (Task 4).
3. Concluding the recheio below target when the bombom would lack is refused with `missing`, and nothing moves (Task 4).
4. Two requests recording a batch and concluding the same item at once never interleave: the batch recorded after the conclusion is refused with "The item is not pending." (Task 2 + Task 4 integration, `Promise.all`).
5. A shortage-added item awaits a weighing until weighed in its card, and only then accepts batches (Task 3).

---

### Task 1: Schema, migration, presentation

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/modules/productions/productions.repository.ts` (select), `productions.service.ts` (presenter), `productions.schemas.ts`, `src/server/modules/pre-weighings/pre-weighings.repository.ts` + `pre-weighing-status.ts` (status of a linked pre-weighing), `src/tests/samples.ts`, `openapi.json`
- Create: `prisma/migrations/20261124000000_add_production_batches/migration.sql`, `prisma/tests/production-batches-schema.integration.test.ts`

**Interfaces:**
- Produces: models `ProductionItemBatch` and `ProductionItemWeighing` and enum `ProductionBatchSource` exactly as in the spec's Data section, with relations (`ProductionItem.batches`, `ProductionItem.extraWeighings`, `PreWeighing.productionWeighing ProductionItemWeighing?`), all `onDelete: Restrict`, indexes on the item FKs.
- Presented item gains `batches: [{ id, quantity: string, expiresAt: string | null (YYYY-MM-DD), source: "PRODUCED" | "EXISTING", createdAt: string }]` (ordered by `createdAt`) and `extraWeighings: number`.
- Pre-weighing status: a pre-weighing linked through `ProductionItemWeighing` reads like the one guiding an item — `PRODUCED` when that item is `FINISHED`, `IN_PRODUCTION` when `PENDING`. Extend `preWeighingStatusOf`'s input and the status where-clauses consistently.

- [ ] **Step 1: Tests** — schema test: a batch and a weighing link round-trip; the same pre-weighing linked twice violates the unique key. Pre-weighings integration: a pre-weighing linked as an extra weighing of a pending item reads `IN_PRODUCTION`, of a finished one `PRODUCED`, and `?status=IN_PRODUCTION` lists it.
- [ ] **Step 2: Red, implement (migration deployed), green** — `npm run test:integration -- prisma/tests src/server/modules/pre-weighings`, `npm test`, `npx tsc --noEmit`; regenerate openapi.

### Task 2: Record and remove batches; damage and substitute guards

**Files:**
- Create: `src/server/modules/productions/production-batches.service.ts`, `src/app/v1/productions/[id]/items/[itemId]/batches/route.ts`, `src/app/v1/productions/[id]/items/[itemId]/batches/[batchId]/route.ts`
- Modify: `productions.repository.ts`, `productions.schemas.ts`, `productions.service.ts` (damage/substitute guards), `productions.routes.integration.test.ts`, `openapi.json`, routes snapshot

**Interfaces:**
- Produces: `recordBatch({ productionId, itemId, quantity: string, expiresAt: string | null, source, createdById }): Promise<ProductionResult>` — refusals in order: production 404 / not in progress 409 (existing messages), item 404 "Production item not found.", 409 "The item is not pending.", 409 "The item waits for a new weighing.", the pending-dependency 409 body used by finish today, 409 `TOO_MANY_PLACES` at the unit's precision; body `batchBodySchema = z.object({ quantity: positiveDecimalSchema, expiresAt: lotExpirySchema, source: z.enum(["PRODUCED", "EXISTING"]) })`.
- `removeBatch({ productionId, itemId, batchId }): Promise<ProductionResult>` — item must be `PENDING`; 404 "Batch not found." when the batch is not that item's.
- Damage and substitute refuse an item with a batch or an extra weighing: 409 "The item already has batches." (shared constant).
- Routes: `POST …/batches` (201 production), `DELETE …/batches/{batchId}` (200 production), auth `PRODUCTION_CREATE`.

- [ ] **Step 1: Integration tests** — record a PRODUCED and an EXISTING batch on the recheio (bombom tree from the existing helper): presented in order; a batch on the bombom while recheio pending → 409 with `waitingFor`; on a finished item → "The item is not pending."; 2.5 on a UNIT item → `TOO_MANY_PLACES`; remove a batch; remove another item's batch → 404; damage and substitute after a batch → "The item already has batches."
- [ ] **Step 2: Red, implement, green**; openapi + snapshot; tsc.

### Task 3: Weigh on the item; shortage adds an item awaiting a weighing

**Files:**
- Modify: `production-batches.service.ts`, `productions.service.ts` (`recordProductionWeighing` and its route removed; `awaitsWeighing` derivation), `productions.repository.ts`, `productions.schemas.ts`, `productions.routes.integration.test.ts`, `openapi.json`, routes snapshot
- Create: `src/app/v1/productions/[id]/items/[itemId]/weighings/route.ts`, `src/app/v1/productions/[id]/items/route.ts`
- Delete: `src/app/v1/productions/[id]/weighings/route.ts`

**Interfaces:**
- Consumes: `preparePreWeighing(tree)` and `insertPreWeighingTree(tree, { createdById, parentId }, client)` from the pre-weighings module; `itemFromPreWeighing`.
- Produces: `weighItem({ productionId, itemId, quantity: string, items: { productSku, weighedQuantity? }[], createdById }): Promise<ProductionResult>` — plans with `preparePreWeighing({ productSku: item.product.sku, quantity, items, stages: [] })` before holding the production (as today's weighing does); then, held: item `PENDING` with no pending dependency; **awaiting a weighing** → the new pre-weighing guides the item (replaces expected quantity and inputs, as `reguideProductionItem` does); otherwise it is an extra weighing — linked through `ProductionItemWeighing` and its lines added to the item's inputs (`upsert` summing per product). Parent of the new pre-weighing: the item's guiding pre-weighing's parent, or the damaged one's parent, or null. Body `itemWeighingBodySchema = z.object({ quantity: positiveDecimalSchema, items: z.array(z.object({ productSku: z.uuid(), weighedQuantity: positiveDecimalSchema.optional() })).min(1) })`.
- `addShortageItem({ productionId, productSku, quantity }): Promise<ProductionResult>` — the product must be taken by an item of the production (409 "Only an intermediate of the production can be added."); creates a `PENDING` item with that expected quantity, no pre-weighing, no inputs. `awaitsWeighing` becomes: no pre-weighing and (a damage named one, or the item has no inputs).
- Routes: `POST /v1/productions/{id}/items/{itemId}/weighings` (200), `POST /v1/productions/{id}/items` (201), auth `PRODUCTION_CREATE`.

- [ ] **Step 1: Integration tests** — extra weighing on the recheio for 0.3 kg: a new pre-weighing `IN_PRODUCTION`, inputs summed (e.g. milk 0.56 + 0.24 = 0.8); weighing a damaged recheio re-guides it (old pre-weighing stays `DAMAGED`); a shortage-added recheio `awaitsWeighing: true`, refuses a batch, then after a weighing accepts one; adding a product no item takes → 409; a weighing that does not match the recipe → 409 and nothing written; the old `/productions/{id}/weighings` route is gone.
- [ ] **Step 2: Red, implement, green**; openapi + snapshot; tsc.

### Task 4: Conclude an item; remove finish and reduce; cancel concludes

**Files:**
- Create: `src/server/modules/productions/production-batches.ts`, `production-batches.test.ts`, `src/app/v1/productions/[id]/items/[itemId]/conclude/route.ts`
- Modify: `production-batches.service.ts`, `productions.service.ts` (finish, reduce removed; cancel; leftovers preview uses the conclusion's consumption), `productions.repository.ts` (lots per expiry), `productions.schemas.ts`, `production-reduction.ts` (remove what only reduce used), `productions.routes.integration.test.ts`, `productions.service.test.ts`, `openapi.json`, routes snapshot
- Delete: `src/app/v1/productions/[id]/finish/route.ts`, `src/app/v1/productions/[id]/items/[itemId]/reduce/route.ts`

**Interfaces:**
- Produces (pure, `production-batches.ts`):
  - `consumptionOf(item: { expectedQuantity: Decimal; inputs: { id; quantity: Decimal; weighed: boolean }[]; batches: { quantity: Decimal; source }[] }, { mainBelowTarget: boolean }): { inputId: string; quantity: Decimal }[]` — scale every input by `min(1, (expected − existing) ÷ expected)`; when `mainBelowTarget`, further scale unweighed inputs by `produced ÷ expected`; stored precision; zero quantities dropped. `weighed` = the input came from a weighed line (a line with `weighedQuantity`); unweighed = a manufactured ingredient taken from stock.
  - `lotsOf(batches): { expiresAt: string | null; produced: Decimal; existing: Decimal }[]` — summed per expiry.
- `concludeItem({ productionId, itemId, belowTarget: boolean, hasLeftoversInCost: boolean, createdById }): Promise<ProductionResult>` — held; item `PENDING`, not awaiting, no pending dependency; ≥ 1 batch (409 "The item has no batch."); produced (sum of all batches) below expected and `!belowTarget` → 409 "The item is below its target."; below target and another item takes this product → the shortage rule over the pending takers with this item's produced quantity added to stock: if short, `failWith(409, "An intermediate would fall short.", { missing: [{ product, quantity }] })`; then the shortage check on `consumptionOf(...)`, consumption, leftovers, cost = what left ÷ sum of PRODUCED (when PRODUCED sum is 0: no PRODUCED lot); one lot per expiry for PRODUCED at that cost and one per expiry for EXISTING at the product's average cost (0 when none); `producedQuantity` = sum of batches; item `FINISHED`; `closeIfResolved`. `mainBelowTarget` = below target and no other item takes this product.
- Route `POST /v1/productions/{id}/items/{itemId}/conclude`, body `{ belowTarget?: boolean (default false), hasLeftoversInCost?: boolean (default true) }`, 200 production, 409 body `finishConflictSchema` extended with `missing`.
- `previewLeftovers(id, itemIds)` uses `consumptionOf` for each item (so the preview matches what concluding takes).
- Cancel: each `PENDING` item with batches concludes inside the cancel transaction with `belowTarget: true`, `hasLeftoversInCost: true`, no below-target rule and no shortage check (balances may go negative), past expiries accepted; items without batches release their pre-weighings as today.
- Removed: `finishProduction`, `reduceProductionItem`, their schemas, routes and tests (rewrite the finish tests as conclude tests where they pinned stock/cost behavior).

- [ ] **Step 1: Unit tests** for `consumptionOf` (25 existing of 50 → ×0.5; all existing → nothing; main 80 of 100 → unweighed ×0.8, weighed whole; combined existing and below target) and `lotsOf`.
- [ ] **Step 2: Integration tests** — conclude at target (two expiries → two lots; cost); 25 produced + 25 existing of 50 → half of each input left, produced lot cost = left ÷ 25, existing lot at average cost; recheio below target with bombom short → `missing`, nothing moved; below target covered by stock → accepted with `belowTarget`; without `belowTarget` → "The item is below its target."; main product below target scales its unweighed lines; no batch → "The item has no batch."; a batch recorded after a conclusion sent together → one of them refused ("The item is not pending."); cancel with a batched item concludes it and releases the others; `/finish` and `/reduce` gone.
- [ ] **Step 3: Red, implement, green** — `npx vitest run src/server/modules/productions`, `npm run test:integration` (all), `npm test`, tsc; openapi + snapshot.

### Task 5: Client actions and types

**Files:**
- Modify: `src/features/productions/actions.ts`, `src/lib/api.ts`, `src/tests/samples.ts`, and the callers of the removed actions (`finishProductionItems`, `reduceProductionItem`, `recordProductionWeighing`) so tsc stays green: `ShortageDialog` loses its "Reduzir" form; `FinishItemForm` calls `concludeItem` (interim until Task 6 replaces it); `PreWeighingPage`'s production mode stops calling `recordProductionWeighing` (it is removed in Task 8 — here only the call goes).

**Interfaces:**
- Produces actions (permission, parse, revalidate as the existing ones): `recordBatch(id, itemId, body)`, `removeBatch(id, itemId, batchId)`, `weighItem(id, itemId, body)`, `concludeItem(id, itemId, body)`, `addShortageItem(id, body)`; `aProductionBatch()` sample; `ProductionItem` sample gains `batches: []`, `extraWeighings: 0`.

- [ ] **Step 1: Tests** — update the mocks/tests that referenced removed actions; ShortageDialog test: only "Nova pesagem" is offered.
- [ ] **Step 2: Red, implement, green** — `npx vitest run src/features/productions`, tsc.

### Task 6: The card — progress, levas, existing stock, conclude

**Files:**
- Create: `src/features/productions/batch-progress.ts` (+ test), `src/features/productions/BatchesSection.tsx`, `src/features/productions/ConcludeItemForm.tsx` (+ tests)
- Modify: `ProductionDetailPage.tsx` (+ test); delete `FinishItemForm.tsx` and its test once `ConcludeItemForm` replaces it

**Interfaces:**
- `progressOf(item): { produced: string; missing: string; reached: boolean }` and its text: reached → `` `${q(produced)} de ${q(expected)} · meta atingida` ``, else `` `${q(produced)} de ${q(expected)} · faltam ${q(missing)}` `` (`q` = `quantityOf(…, unit)`); a `<progress>` (or `role="progressbar"` with `aria-valuenow`/`aria-valuemax`) labelled `` `Progresso de ${d}` ``.
- Levas list: one row per batch — `formatDateTime(createdAt)`, quantity, `formatDate(expiresAt)` or "sem validade", "já existia" for EXISTING, and a button `` `Remover leva de ${formatDateTime(createdAt)}` ``.
- "Registrar leva": fields `` `Quantidade da leva de ${d}` `` (label "Quantidade") and `` `Validade da leva de ${d}` `` (label "Validade (opcional)"), button "Registrar leva". "Lançar do que já existe": a button that reveals the same two fields and a "Lançar" button, sending `source: "EXISTING"`. Fields use `bg-background`.
- `ConcludeItemForm({ production, item })` — leftovers preview for its item and the leftover-cost choice (as FinishItemForm did), button `` `Concluir ${d}` ``, disabled without a batch. Below target: an intermediate (another item takes it) sends `belowTarget: true` and, on 409 `missing`, shows `` `Falta ${q(quantity)} de ${product} para o que vem depois. Registre ou pese mais uma leva.` ``; the main product first asks in an AlertDialog `` `Rendeu ${q(produced)} de ${q(expected)}. Concluir assim?` `` with "Concluir assim" / "Voltar". Success toast "Item concluído." or "Produção finalizada." by the returned status; other 409 → "Um item mudou enquanto isso. A página foi atualizada." + refresh.

- [ ] **Step 1: Tests** — progress text and bar values (35 of 50; reached); registering a leva sends the body; launching existing sends `EXISTING`; removing calls the action; conclude disabled without a batch; main product below target shows the confirmation and sends `belowTarget: true`; intermediate refusal shows the missing text.
- [ ] **Step 2: Red, implement, green** — `npx vitest run src/features/productions`, tsc.

### Task 7: Weigh inside the card

**Files:**
- Create: `src/features/productions/ItemWeighingPanel.tsx` (+ test)
- Modify: `ProductionDetailPage.tsx` (+ test)

**Interfaces:**
- Consumes: `planProductionItem({ productSku, quantity })` (existing action, plans without stages) and `weighItem`.
- Panel: field "Quanto fazer" (default: `progressOf(item).missing`, or the expected quantity on an item awaiting a weighing), "Calcular" re-plans; one row per plan item — description, planned quantity, and a "Pesado" field (`` `Pesado de ${ingredient}` ``) on bought ingredients; manufactured ingredients show "do estoque" with no field; button "Registrar pesagem" sends `{ quantity, items }` (weighed quantities in the ingredient's unit, as the pre-weighing screen converts). A card offers it behind "Pesar mais uma leva"; an item awaiting a weighing shows it open as its main action (replacing the "Nova pesagem" link). Fields use `bg-background`.

- [ ] **Step 1: Tests** — default quantity is what is missing; calculating shows the rows; recording sends the body; awaiting card shows the panel open; a 409 shows "A receita ou o produto mudou. Calcule de novo."
- [ ] **Step 2: Red, implement, green**; tsc.

### Task 8: Shortage dialog, pre-weighing screen, timeline events

**Files:**
- Modify: `src/features/productions/ShortageDialog.tsx` (+ test), `src/features/productions/timeline.ts` (+ test), `src/features/pre-weighings/PreWeighingPage.tsx` (+ test), `src/app/(app)/(production)/pre-weighings/new/page.tsx`

**Interfaces:**
- ShortageDialog: per short product, "Nova pesagem" calls `addShortageItem(production.id, { productSku, quantity: missing })`, closes and refreshes; no "Reduzir".
- Pre-weighing screen: drop `productionId` / `itemId` handling and the "Nova pesagem para a produção" mode; the plain `?parentId=` complement stays.
- Timeline: one event per batch, at `createdAt`: `` `Leva de ${d} registrada · ${q(quantity)}` `` and, for EXISTING, `` `Leva de ${d} registrada · ${q(quantity)} · já existia` `` (`item` set, `ends: false`).

- [ ] **Step 1: Tests**, **Step 2: Red, implement, green** — `npx vitest run src/features`, `npm test`, tsc.

### Task 9: Final verification

- [ ] `npx tsc --noEmit`; `npm test`; `npm run test:integration`; `npx prisma migrate status`; `npm run openapi:dump` leaves no diff; eslint and prettier on changed files (and `npx prettier --check .` clean outside ignored scratch). Paste every output.
