# Production Stages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A production guided by a root pre-weighing carries its intermediates as items finished one by one in dependency order, with damage and substitution per item, and pre-weighings show a status with a warning for stale pending ones.

**Architecture:** Items gain a state (`PENDING | FINISHED | SUBSTITUTED`) and are finished in subsets; a pure function derives which items an item waits for, by product. Damages are their own table whose losses are `StockLoss` rows. Pre-weighing status is derived from the item that guides it and from a damage that names it; it is never stored.

**Tech Stack:** Next.js App Router, Prisma 6 / Postgres, zod v4, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-22-production-stages-design.md`

## Global Constraints

- Code, identifiers, comments, tests in English; screen texts in Portuguese (pt-BR).
- Business rules live in `service`; `route.ts` and actions are adapters. Every route declares `auth`.
- `schemas` files must not import `@prisma/client`. Front types come from `src/lib/api.ts` (`import type` only).
- TDD: each test is run red before its implementation; paste the red output in the report.
- **Do not commit.** The user commits only on explicit order: each task ends with its verification, the work stays in the tree.
- Integration tests run on schema `test` (`npm run test:integration`); never reset the dev database. Migrations: `npx prisma migrate dev --create-only --name <name>`, then `npx prisma migrate deploy`.
- Never read `.env*`.
- A route change regenerates `openapi.json` (`npm run openapi:dump`) and the routes snapshot (`npx vitest run src/server/routes.test.ts -u`) in the same task.
- Test factories in `src/tests/samples.ts` follow every schema change in the task that makes it, so `npx tsc --noEmit` stays clean after each task.
- Stale cutoff: **48 hours** (`STALE_AFTER_MS = 48 * 60 * 60 * 1000`).

## Review Focus

1. A guided item whose damage left it without a pre-weighing must not be finishable — finish answers 409 "The item waits for a new weighing." (Task 6).
2. Finishing an item that another `PENDING` item of the production makes an input of → 409 naming the items it waits for, nothing moved (Task 6).
3. Two simultaneous requests (finish and damage of the same item) — the second sees the item no longer `PENDING` because every item operation holds the production row first (Tasks 6–9, one integration test in Task 7).
4. Deleting a `DAMAGED` pre-weighing must answer 409, not a foreign-key crash (Task 3).
5. Cancel after a stage finished must keep that stage's pre-weighing `PRODUCED` and release only the `PENDING` items' pre-weighings (Task 10).

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261122000000_add_production_stages/migration.sql`
- Create: `prisma/tests/production-stages-schema.integration.test.ts`
- Modify: `src/server/modules/productions/productions.repository.ts`, `productions.schemas.ts`, `productions.service.ts`, `src/tests/samples.ts`, `src/features/productions/*` (only what the moved field breaks)

**Interfaces:**
- Produces: enum `ProductionItemStatus { PENDING FINISHED SUBSTITUTED }`; `ProductionItem.status` (default `PENDING`), `finishedAt DateTime?`, `hasLeftoversInCost Boolean?`, `damages ProductionItemDamage[]`; model `ProductionItemDamage { id, productionItemId, preWeighingId String? @unique, reasonId, note String?, losses StockLoss[], createdById, createdAt }` with relations to `ProductionItem`, `PreWeighing` (back-relation `damage ProductionItemDamage?`), `LossReason`, `User`, all `onDelete: Restrict`, table `production_item_damages`; `StockLoss.damageId String?` (`damage_id`, indexed); `Production.hasLeftoversInCost` removed.
- Presented production: `hasLeftoversInCost` moves from the production to each item; items also present `status` and `finishedAt` (ISO or null).

- [ ] **Step 1: Write the failing schema test** — `production-stages-schema.integration.test.ts`: (a) a new item reads `status: "PENDING"`, `finishedAt: null`, `hasLeftoversInCost: null`; (b) two damages naming the same pre-weighing violate the unique constraint (Prisma `P2002`); (c) a `StockLoss` with `damageId` of a damage is read back with it.
- [ ] **Step 2: Run it red** — `npm run test:integration -- prisma/tests/production-stages-schema.integration.test.ts` → fails on unknown fields.
- [ ] **Step 3: Edit the schema, create the migration with `--create-only`, then add to its SQL, before the `DROP COLUMN`:**

```sql
UPDATE production_items AS item
SET status = 'FINISHED', finished_at = production.finished_at,
    has_leftovers_in_cost = production.has_leftovers_in_cost
FROM productions AS production
WHERE item.production_id = production.id AND production.status = 'FINISHED';
```

  Apply with `npx prisma migrate deploy`. Move `hasLeftoversInCost` in the repository select, presenter and `productionSchema` to the item; `markProductionFinished` stops writing it and the finish writes it on each item (`status: FINISHED`, `finishedAt`, `hasLeftoversInCost`) — behavior otherwise unchanged in this task.
- [ ] **Step 4: Run green** — the schema test, `npm run test:integration -- src/server/modules/productions`, `npm test`, `npx tsc --noEmit`; update fixtures that read `production.hasLeftoversInCost`.

### Task 2: Dependencies between items

**Files:**
- Create: `src/server/modules/productions/production-dependencies.ts`, `production-dependencies.test.ts`

**Interfaces:**
- Produces: `type DependencyItem = { id: string; productSku: string; status: "PENDING" | "FINISHED" | "SUBSTITUTED"; inputSkus: string[] }`; `dependenciesOf(items: DependencyItem[]): Map<string, string[]>` (item id → ids of the other items whose `productSku` is in its `inputSkus`, comparison lower-case, production order kept); `waitingFor(itemId: string, items: DependencyItem[]): string[]` (those dependencies still `PENDING`).

- [ ] **Step 1: Tests** — bombom (inputs recheio, casquinha, sprinkles) with recheio and casquinha items → `dependenciesOf` gives bombom `[recheio, casquinha]`, the others `[]`; casquinha also taking recheio → casquinha `[recheio]`; two recheio items (original and complement) → bombom waits for both; `waitingFor` drops `FINISHED` and `SUBSTITUTED`; SKUs in mixed case match.
- [ ] **Step 2: Red** — `npx vitest run src/server/modules/productions/production-dependencies.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Green.**

### Task 3: Pre-weighing status, list filter, stale count, delete rule

**Files:**
- Create: `src/server/modules/pre-weighings/pre-weighing-status.ts`, `pre-weighing-status.test.ts`, `src/app/v1/pre-weighings/stale-count/route.ts`
- Modify: `pre-weighings.repository.ts`, `pre-weighings.schemas.ts`, `pre-weighings.service.ts`, `pre-weighings.routes.integration.test.ts`, `src/app/(app)/(production)/productions/new/page.tsx` (filter `status: "PENDING"` until Task 11), `src/features/pre-weighings/PreWeighingDetailPage.tsx` (`status === "PENDING"` instead of `isAvailable`), `src/features/productions/actions.ts` (`loadMoreAvailablePreWeighings` passes `status: "PENDING"`), `src/lib/api.ts`, `src/tests/samples.ts`, `openapi.json`, routes snapshot

**Interfaces:**
- Produces: `type PreWeighingStatus = "PENDING" | "IN_PRODUCTION" | "PRODUCED" | "DAMAGED"` (zod enum `preWeighingStatusSchema` in schemas); `preWeighingStatusOf(input: { damaged: boolean; itemStatus: "PENDING" | "FINISHED" | "SUBSTITUTED" | null }): PreWeighingStatus`; `STALE_AFTER_MS`; `isStale(createdAt: Date, now: Date): boolean`; presented `status` replaces `isAvailable`; `listPreWeighingsQuerySchema` gets `status?` and `staleOnly?: "true"` (replacing `available`); `countStalePreWeighings(now = new Date()): Promise<number>`; `GET /v1/pre-weighings/stale-count` → `{ count }`, `auth: PRODUCTION_READ`.
- Repository where-clauses: `DAMAGED` `{ damage: { isNot: null } }`; `PRODUCED` `{ damage: null, production: { status: "FINISHED" } }`; `IN_PRODUCTION` `{ damage: null, production: { status: "PENDING" } }`; `PENDING` `{ damage: null, production: null }`; `staleOnly` adds `PENDING` and `createdAt < now − 48 h`.
- Delete: refuses when any pre-weighing of the tree is guided by an item **or** named by a damage; message becomes "The pre-weighing is not pending." (update the existing tests).

- [ ] **Step 1: Unit tests** for `preWeighingStatusOf` (damage wins over everything; `FINISHED` → `PRODUCED`; `PENDING` → `IN_PRODUCTION`; null → `PENDING`) and `isStale` (exactly 48 h is not stale; 48 h + 1 ms is).
- [ ] **Step 2: Integration tests** — each status presented on `GET /v1/pre-weighings/{id}`; `?status=` returns only that status; `?staleOnly=true` returns a pending one created 3 days ago (set `createdAt` with `testPrisma`) and not one created now nor a produced old one; `stale-count` answers `{ count: 1 }` for that data; deleting a damaged pre-weighing → 409 "The pre-weighing is not pending."; `?available=` now answers 400.
- [ ] **Step 3: Red, implement, green** — `npx vitest run src/server/modules/pre-weighings` and `npm run test:integration -- src/server/modules/pre-weighings`; regenerate openapi and snapshot; `npx tsc --noEmit`.

### Task 4: Pre-weighing tree read and start candidates

**Files:**
- Modify: `pre-weighings.repository.ts`, `pre-weighings.service.ts`, `pre-weighings.schemas.ts`, `pre-weighings.routes.integration.test.ts`, `src/lib/api.ts`, `openapi.json`, routes snapshot
- Create: `src/app/v1/pre-weighings/start-candidates/route.ts`

**Interfaces:**
- Produces: `findPreWeighingTree(rootId: string, client?: Prisma.TransactionClient): Promise<PreWeighingRecord[]>` (root first, then descendants depth-first); `type StartCandidate = PresentedPreWeighing & { stages: StartCandidate[] }`; `listStartCandidates(): Promise<StartCandidate[]>` — every `PENDING` pre-weighing whose parent is null or not `PENDING`, newest first, with its `PENDING` descendants nested (a non-pending child cuts its branch); `GET /v1/pre-weighings/start-candidates` → `StartCandidate[]`, `auth: PRODUCTION_READ`; schema `startCandidateSchema` (recursive via `z.lazy`, hoisted by the OpenAPI generator).
- Removes: `findAncestorIds` once Task 5 drops its only caller (delete it in Task 5).

- [ ] **Step 1: Integration tests** — bombom root with recheio and casquinha stages → one candidate with two `stages`; the recheio guided by a production → candidate has only casquinha; root produced and a complement under it pending → the complement is a candidate of its own; nothing pending → `[]`.
- [ ] **Step 2: Red, implement, green**; openapi and snapshot; tsc.

### Task 5: Start production — guided by one root, or free

**Files:**
- Modify: `productions.schemas.ts`, `productions.service.ts`, `productions.repository.ts`, `productions.service.test.ts`, `productions.routes.integration.test.ts`, `src/features/productions/StartProductionPage.tsx` (only to send the new body: one checked root → `{ preWeighingId }`, else `{ items }`), its test, `src/lib/api.ts`, `src/tests/samples.ts`, `openapi.json`, routes snapshot; delete `findAncestorIds`.

**Interfaces:**
- Produces: `startProductionBodySchema = z.union([z.strictObject({ preWeighingId: z.uuid() }), z.strictObject({ items: z.array(freeItemSchema).min(1) })])`; `itemFromPreWeighing(record: PreWeighingRecord): PlannedProductionItem` (exported from the service, reused in Task 9; inputs `weighedQuantity ?? plannedQuantity`).
- Guided start: the pre-weighing must be a start candidate (404 "Pre-weighing not found.", 409 "The pre-weighing is not a pending root." otherwise); items = it and its `PENDING` descendants from `findPreWeighingTree`, cut at a non-pending node; a unique violation stays 409 "A pre-weighing already guides another production.".

- [ ] **Step 1: Tests** — guided start of the bombom tree makes three items with their pre-weighings; a body with both shapes → 400; a non-root pending child → 409; the old "together with one of its intermediates" test is removed; free start unchanged.
- [ ] **Step 2: Red, implement, green**; openapi, snapshot, `npm test`, tsc.

### Task 6: Finish a subset of items

**Files:**
- Modify: `productions.service.ts`, `productions.repository.ts`, `productions.schemas.ts`, `productions.routes.integration.test.ts`, `src/app/v1/productions/[id]/leftovers/route.ts`, `src/features/productions/FinishProductionForm.tsx` (send every `PENDING` item, so the screen keeps working until Task 12), `src/lib/api.ts`, `openapi.json`, routes snapshot

**Interfaces:**
- Consumes: `waitingFor` (Task 2).
- Produces: `finishProduction` keeps its input shape; it locks with `lockProductionInProgress`, then refuses, in this order, with nothing moved: an id not of the production → 409 "The items do not match the items of the production."; an item not `PENDING` → 409 "The item is not pending."; a guided item without a pre-weighing (it has a damage that named one) → 409 "The item waits for a new weighing."; pending dependencies → 409 `failWith(409, "An item waits for another item of the production.", { waitingFor: [{ itemId, product, waitsFor: [{ itemId, product }] }] })`; then the shortage check as today over the finishing items. Consumption, shared leftovers and costs run over the finishing items only; each gets `status FINISHED`, `finishedAt`, `hasLeftoversInCost`; `closeIfResolved(tx, productionId)` (repository) marks the production `FINISHED` with `finishedAt` when no item is `PENDING`.
- `previewLeftovers(id: string, itemIds?: string[])`; the leftovers route takes `?items=<id>` repeated (default: all `PENDING` items).
- Presented items gain `dependsOn: string[]` (from `dependenciesOf`) and `awaitsWeighing: boolean`.
- `finishConflictSchema` gains `waitingFor` (optional).

- [ ] **Step 1: Integration tests** (bombom tree from Task 5's start) — finish recheio and casquinha together sharing one opened can (leftover split as today), production still `IN_PROGRESS`; finish bombom while casquinha pending → 409 with `waitingFor` naming casquinha, no movement; finish bombom after both → production `FINISHED`, bombom consumed their lots; finishing a `FINISHED` item → 409 "The item is not pending."; leftovers preview for `items=recheio` only.
- [ ] **Step 2: Red, implement, green**; existing finish tests adjusted to the per-item rules; openapi, snapshot, tsc, `npm test`.

### Task 7: Damage an item

**Files:**
- Modify: `src/server/modules/losses/losses.repository.ts` (export the reason hold), `productions.service.ts`, `productions.repository.ts`, `productions.schemas.ts`, `productions.routes.integration.test.ts`, `src/lib/api.ts`, `openapi.json`, routes snapshot
- Create: `src/app/v1/productions/[id]/items/[itemId]/damage/route.ts`

**Interfaces:**
- Produces: `holdReasonInUse(client, reasonId)` exported from the losses repository (throws the existing `RefusedReason`; the service maps it with the existing messages "Loss reason not found." 404 / "Loss reason is inactive." 409); `writeOffForDamage(tx, { productSku, quantity, damageId, reasonId, note, createdById, today })` in the productions repository: `takeFromLots`, one `LOSS` movement per take, one `StockLoss` per take with a lot (`damageId` set); what had no lot is a `LOSS` movement only.
- `damageProductionItem(input: { productionId; itemId; reasonId; note?: string | null; createdById }): Promise<ProductionResult>` — lock; 404 "Production item not found."; 409 "The item is not pending."; 409 "The item waits for a new weighing."; 409 "An item waits for another item of the production." (same body as finish); creates the damage (`preWeighingId` = the item's, or null), writes off every input, sets the item's `preWeighingId` to null (inputs and expected quantity stay until a new weighing replaces them).
- Body `damageProductionItemBodySchema = z.object({ reasonId: z.uuid(), note: z.string().trim().max(500).nullish() })`; route `POST`, `auth: PRODUCTION_CREATE`, 200 production.
- Presented items gain `damages: [{ id, reason: { id, name }, note, createdAt, preWeighingId }]`.

- [ ] **Step 1: Integration tests** — damage the recheio: one `StockLoss` per lot taken with the reason and `damageId`, its pre-weighing reads `DAMAGED`, the item reads `awaitsWeighing: true`, the bombom still waits for it; damage a free item: losses written, item stays `PENDING` with `awaitsWeighing: false` and can be finished; damage a finished item → 409; damage the bombom while casquinha pending → 409; inactive reason → 409 and nothing moved; a finish and a damage of the same item sent together → one succeeds, the other answers 409 "The item is not pending." (`Promise.all`).
- [ ] **Step 2: Red, implement, green**; openapi, snapshot, tsc.

### Task 8: Substitute an intermediate

**Files:**
- Modify: `productions.service.ts`, `productions.repository.ts`, `productions.schemas.ts`, `productions.routes.integration.test.ts`, `src/lib/api.ts`, `openapi.json`, routes snapshot
- Create: `src/app/v1/productions/[id]/items/[itemId]/substitute/route.ts` (`GET` preview, `POST` substitute)

**Interfaces:**
- Produces: `previewSubstitution({ productionId, itemId }): Promise<Result<{ product; needed: string; available: string }, 404 | 409>>` — `needed` = what the `PENDING` items of the production take of the item's product, `available` = its stock balance (0 when none); `substituteProductionItem({ productionId, itemId }): Promise<ProductionResult>` — lock; 404; 409 "The item is not pending."; 409 "Only an intermediate can be substituted." when no other item of the production takes its product; sets `SUBSTITUTED` and `preWeighingId` null, then `closeIfResolved`. Both `auth`: preview `PRODUCTION_READ`, substitute `PRODUCTION_CREATE`.

- [ ] **Step 1: Integration tests** — preview of recheio gives needed 1, available 0.3; substitute recheio → its pre-weighing `PENDING`, bombom no longer waits for it; bombom finish then fails the shortage check (0.3 < 1); substitute the bombom → 409 "Only an intermediate can be substituted."; substituting the last pending item finishes the production.
- [ ] **Step 2: Red, implement, green**; openapi, snapshot, tsc.

### Task 9: A new weighing inside a production

**Files:**
- Modify: `pre-weighings.service.ts` (split), `pre-weighings.repository.ts` (`insertPreWeighingTree` takes a client), `productions.service.ts`, `productions.repository.ts`, `productions.schemas.ts`, `productions.routes.integration.test.ts`, `pre-weighings.service.test.ts`, `src/lib/api.ts`, `openapi.json`, routes snapshot
- Create: `src/app/v1/productions/[id]/weighings/route.ts`

**Interfaces:**
- Consumes: `itemFromPreWeighing` (Task 5), `findPreWeighingTree` (Task 4).
- Produces: `preparePreWeighing(tree: StageBody): Promise<Result<PlannedStage, 404 | 409>>` (re-plan and match; `recordPreWeighing` becomes `checkParent` + `preparePreWeighing` + insert); `insertPreWeighingTree(tree, { createdById, parentId }, client = prisma)`.
- `recordProductionWeighing(input: { productionId; createdById; itemId?: string; parentId?: string; tree: StageBody }): Promise<ProductionResult>` — in one transaction, production locked: with `itemId` the item must be `PENDING` and `awaitsWeighing` (409 "The item does not wait for a new weighing."), its product the tree's (409 "The product does not match the item."); the tree is inserted with the damaged pre-weighing's `parentId`; the item takes the root (`preWeighingId`, `expectedQuantity`, inputs replaced via `itemFromPreWeighing`). With `parentId` the parent must guide a `PENDING` item of this production (409 "The parent is not a pending item of the production."); the tree is inserted under it. In both, every stage pre-weighing of the tree becomes a new item.
- Body `productionWeighingBodySchema = preWeighingStageBodySchema.extend({ itemId: z.uuid().optional(), parentId: z.uuid().optional() })` refined to exactly one of them; route `POST /v1/productions/{id}/weighings`, `auth: PRODUCTION_CREATE`, 200 production.

- [ ] **Step 1: Integration tests** — after damaging the recheio, a weighing with `itemId` re-guides the item, the old pre-weighing stays `DAMAGED`, the new one `IN_PRODUCTION` with the old one's `parentId`, and the recheio then finishes; a shortage complement with `parentId` = bombom's pre-weighing adds a recheio item the bombom now waits for; `itemId` of an item not awaiting → 409; production not in progress → 409 and no pre-weighing written; both or neither of `itemId`/`parentId` → 400.
- [ ] **Step 2: Red, implement, green** (existing `recordPreWeighing` tests stay green); openapi, snapshot, tsc.

### Task 10: Cancel with finished stages

**Files:**
- Modify: `productions.repository.ts` (`releasePreWeighings` only on `PENDING` items), `productions.service.ts` (comment), `productions.routes.integration.test.ts`

- [ ] **Step 1: Integration test** — recheio finished, then cancel: production `CANCELED`, the recheio lot stays in stock, recheio's pre-weighing `PRODUCED`, bombom's and casquinha's `PENDING`.
- [ ] **Step 2: Red, implement, green.**

### Task 11: Client — actions and the new production screen

**Files:**
- Modify: `src/features/productions/actions.ts`, `src/features/productions/StartProductionPage.tsx` and test, `src/app/(app)/(production)/productions/new/page.tsx`, `src/lib/api.ts`, `src/tests/samples.ts`
- Remove: `loadMoreAvailablePreWeighings` (candidates are not paged)

**Interfaces:**
- Produces actions (each checks permission like the existing ones, revalidates `/productions`, the detail path and `/pre-weighings`): `startProduction(body)`, `finishProductionItems(id, body)` (rename of `finishProduction`), `damageProductionItem(id, itemId, body)`, `previewSubstitution(id, itemId)`, `substituteProductionItem(id, itemId)`, `recordProductionWeighing(id, body)`; `aStartCandidate()` sample.
- Screen: a choice "Com pré-pesagem" / "Sem pré-pesagem" (radio group, nothing chosen at first); only the chosen form shows. Com pré-pesagem: the candidates as a nested list, one radio per root, its stages listed under it as "Recheio — 0,7 kg" without control; "Nenhuma pré-pesagem pendente." when empty; "Iniciar produção" sends `{ preWeighingId }`. Sem pré-pesagem: the current free form, sending `{ items }`.

- [ ] **Step 1: RTL tests** — neither form before the choice; switching to "Sem pré-pesagem" hides the tree and keeps no checked root; picking the bombom root shows recheio and casquinha under it and starts with `{ preWeighingId }`; free mode starts with `{ items }`.
- [ ] **Step 2: Red, implement, green** — `npx vitest run src/features/productions`, tsc.

### Task 12: Client — production detail with item states and finishing a subset

**Files:**
- Modify: `src/features/productions/ProductionDetailPage.tsx` and test, `FinishProductionForm.tsx` and test, `ShortageDialog.tsx` and test
- Create: `src/features/productions/item-state.ts`, `item-state.test.ts`

**Interfaces:**
- Produces: `itemStateLabel(item, items): string` — "Finalizado", "Substituído pelo estoque", "Avariado — aguardando nova pesagem" (`awaitsWeighing`), `Aguardando ${names joined by ", "}` (pending dependencies, product descriptions), "A produzir".
- Detail: items ordered as a tree (an item under the items that take it, by `dependsOn`; roots first), each with its state badge. The finish form lists only items that are `PENDING`, not awaiting weighing and with no pending dependency, each with a checkbox (all unchecked), produced quantity and expiry for the checked ones; leftovers preview asked for the checked ids; "Finalizar selecionados". The pending-dependency 409 shows the message from `waitingFor`. ShortageDialog "Nova pesagem" links to `/pre-weighings/new?productionId=&parentId=&productSku=&quantity=`. `CancelProductionDialog` takes `hasFinishedItems` and, when true, its description reads "Os itens já finalizados continuam no estoque. As pré-pesagens dos demais voltam a ficar pendentes."

- [ ] **Step 1: Tests** — `itemStateLabel` for each state; detail shows "Aguardando Casquinha, Recheio" on the bombom; finish form offers recheio and casquinha, not bombom; finishing only recheio sends one item; the shortage link carries `productionId`; the cancel dialog text with and without finished items.
- [ ] **Step 2: Red, implement, green**; tsc.

### Task 13: Client — damage and substitute dialogs

**Files:**
- Create: `src/features/productions/DamageItemDialog.tsx` and test, `SubstituteItemDialog.tsx` and test
- Modify: `ProductionDetailPage.tsx`, `src/app/(app)/(production)/productions/[id]/page.tsx` (loads active loss reasons with the existing losses service)

**Interfaces:**
- Damage: button "Registrar avaria" on items that are `PENDING`, not awaiting, with no pending dependency; dialog "Registrar avaria de <produto>?", description "Os ingredientes vão para as perdas e nada entra no estoque.", reason select (active loss reasons), optional note, "Confirmar avaria"; 409 → toast with the message map below and refresh.
- Substitute: button "Usar do estoque" on `PENDING` items another item takes; on open it calls `previewSubstitution` and says "No estoque: <available> · necessário: <needed>", with "O estoque não cobre o necessário." in destructive text when `available < needed`; "Confirmar".
- Nova pesagem: link on items with `awaitsWeighing`, to `/pre-weighings/new?productionId=&itemId=&productSku=&quantity=<expectedQuantity>`.
- Message maps: 404 "Esse item não existe mais."; 409 "O item mudou enquanto isso. A página foi atualizada.".

- [ ] **Step 1: RTL tests** for both dialogs (confirm, back, 409) and for which items show each button.
- [ ] **Step 2: Red, implement, green**; tsc.

### Task 14: Client — the pre-weighing screen recording for a production

**Files:**
- Modify: `src/app/(app)/(production)/pre-weighings/new/page.tsx`, `src/features/pre-weighings/PreWeighingPage.tsx` and test

**Interfaces:**
- `?productionId=&itemId=&productSku=&quantity=` and `?productionId=&parentId=&productSku=&quantity=` prefill like a complement does today and record through `recordProductionWeighing`; after recording, the screen goes to `/productions/<productionId>` with a success toast "Pré-pesagem registrada."; the heading says "Nova pesagem para a produção". The plain `?parentId=` complement keeps working as today.

- [ ] **Step 1: RTL tests** — with `itemId` it calls `recordProductionWeighing` with `{ itemId, ...tree }` and navigates to the production; with `parentId` likewise with `{ parentId, ... }`.
- [ ] **Step 2: Red, implement, green**; tsc.

### Task 15: Client — pre-weighing status in the list and detail, stale warning

**Files:**
- Create: `src/features/pre-weighings/PreWeighingStatusBadge.tsx`
- Modify: `PreWeighingsListPage.tsx` and test, `PreWeighingDetailPage.tsx` and test, `src/app/(app)/(production)/pre-weighings/page.tsx`

**Interfaces:**
- Labels: `PENDING` "Pendente", `IN_PRODUCTION` "Em produção", `PRODUCED` "Produzida", `DAMAGED` "Avariada".
- List: "Status" column with the badge; a status filter (all, and the four) driving `?status=`; at the top, when `countStalePreWeighings()` > 0, a warning box (`role="status"`) "1 pré-pesagem pendente há mais de 2 dias" / "N pré-pesagens pendentes há mais de 2 dias" with a link "Ver" to `/pre-weighings?staleOnly=true`. Detail: the badge under the title.

- [ ] **Step 1: RTL tests** — badge per status; filter changes the address; singular and plural warning; no warning at 0.
- [ ] **Step 2: Red, implement, green**; tsc.

### Task 16: Final verification

- [ ] `npx tsc --noEmit`; `npm test`; `npm run test:integration` (schema `test`); `npx eslint` and `npx prettier --check` on the changed files; `npm run openapi:dump` leaves no diff; `npx prisma migrate status` up to date. Paste every output.
