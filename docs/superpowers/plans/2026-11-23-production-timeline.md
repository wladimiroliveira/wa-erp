# Production Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The production screen becomes a vertical timeline — Feito, Agora, Depois — that guides the operator at the bench, with finishing inside each stage's card.

**Architecture:** The server records when an item was substituted and presents when each item's pre-weighing was recorded. A pure client function derives the three sections from the production; the screen renders them, with a one-item finish form per card. Nothing about the timeline is stored.

**Tech Stack:** Next.js App Router, Prisma 6 / Postgres, zod v4, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-23-production-timeline-design.md`

## Global Constraints

- Code, identifiers, comments, tests in English; screen texts in pt-BR, exactly as this plan gives them.
- Business rules in `service`; `route.ts` and actions are adapters. `schemas` files never import `@prisma/client`; front types come from `src/lib/api.ts` via `import type`; test factories in `src/tests/samples.ts`.
- TDD: each test is run red before its implementation; paste the red output in the report.
- **Do not commit.** The user commits only on explicit order. Do not change git state.
- Integration tests run on schema `test` (`npm run test:integration`); never reset the dev database. Migration: `npx prisma migrate dev --create-only --name <name>` (write the SQL by hand if it refuses non-interactively), then `npx prisma migrate deploy`.
- Never read `.env*`.
- A presentation/schema change regenerates `openapi.json` (`npm run openapi:dump`) in the same task.
- The working tree already holds uncommitted work this plan builds on: `src/features/productions/ItemDetailsSheet.tsx` (the receipt button and its sheet) and its use in `ProductionDetailPage.tsx`.
- Notebook width only; no tablet/phone layout work.

## Review Focus

1. Two stages in Agora at once (recheio and casquinha): each card's finish sends only its own item, and typing in one card does not touch the other (Task 3, Task 4).
2. A finished item still shows its receipt (facts, inputs, costs) from its Feito line (Task 4).
3. A canceled production with pending items shows them in Depois as "Não produzido", with no action (Task 2, Task 4).
4. An item substituted before this change (`substitutedAt` null) still appears in Feito, without a time, last among the timed events (Task 2).
5. A refresh after finishing one stage moves it to Feito and the next ready stage into Agora (Task 4).

---

### Task 1: When an item was substituted and when its pre-weighing was recorded

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/modules/productions/productions.repository.ts`, `productions.service.ts`, `productions.schemas.ts`, `productions.routes.integration.test.ts`, `src/tests/samples.ts`, `openapi.json`
- Create: `prisma/migrations/20261123000000_add_production_item_substituted_at/migration.sql`

**Interfaces:**
- Produces: `ProductionItem.substitutedAt DateTime? @map("substituted_at") @db.Timestamptz(3)`, set to now by the substitute write. Presented item gains `substitutedAt: string | null` (ISO) and `weighedAt: string | null` — the `createdAt` of the pre-weighing the item is guided by now (`item.preWeighing.createdAt`), null on an item without one.

- [ ] **Step 1: Integration tests** — substituting the recheio presents `substitutedAt` as an ISO string within the last minute; a guided item presents `weighedAt` equal to its pre-weighing's `createdAt`; a free item presents `weighedAt: null`; after a damage and a new weighing the item's `weighedAt` is the new pre-weighing's `createdAt`.
- [ ] **Step 2: Red** — `npm run test:integration -- src/server/modules/productions`.
- [ ] **Step 3: Implement** (schema, migration, deploy, repository select, presenter, zod schema, sample factory defaults `substitutedAt: null`, `weighedAt: null`), regenerate `openapi.json`.
- [ ] **Step 4: Green** — the same command, `npm test`, `npx tsc --noEmit`.

### Task 2: The timeline, as a pure function

**Files:**
- Create: `src/features/productions/timeline.ts`, `src/features/productions/timeline.test.ts`

**Interfaces:**
- Consumes: `finishableItems`, `canSubstitute` from `src/features/productions/item-state.ts`; `Production`, `ProductionItem` from `src/lib/api.ts`.
- Produces:

```ts
export type TimelineEvent = {
  at: string | null; // ISO; null only for a substitution recorded before substitutedAt existed
  text: string;
  item: ProductionItem | null; // the item the event is about; null for the production's own events
};

export function timelineOf(production: Production): {
  done: TimelineEvent[]; // ordered by `at`, oldest first; events with `at: null` last, in item order
  now: ProductionItem[]; // finishable items, then items awaiting a weighing, in the production's item order
  next: { item: ProductionItem; waitsFor: string[]; notProduced: boolean }[];
};
```

- Event texts (pt-BR, exact): `"Produção iniciada"` (production `createdAt`); `` `${d} finalizado · ${quantityOf(item.producedQuantity, unit)}` `` (item `finishedAt`); `` `${d} avariado · ${damage.reason.name}` `` (each damage `createdAt`); `` `${d} substituído pelo estoque` `` (item `substitutedAt`, may be null); `` `Nova pesagem de ${d}` `` (item `weighedAt`, when the item has a damage and a pre-weighing now); `` `Pesagem adicional de ${d}` `` (item `weighedAt`, when it has no damage and `weighedAt` is after the production's `createdAt`); `"Produção finalizada"` / `"Produção cancelada"` (production `finishedAt` / `canceledAt`). `d` is `item.product.description`; `quantityOf` comes from `src/features/stock/stock-format`.
- `next`: every `PENDING` item not in `now`, ordered so an item comes after the items it waits for; `waitsFor` = descriptions of its pending dependencies (by `dependsOn`), sorted alphabetically; on a `CANCELED` production `now` is empty, every `PENDING` item is in `next` with `notProduced: true` and `waitsFor: []`. On a `FINISHED` production `now` and `next` are empty.

- [ ] **Step 1: Tests** — bombom example (casquinha finished at 10:42 with 48 un, recheio pending, bombom depending on both): `done` = ["Produção iniciada", "Casquinha finalizado · 48 un"], `now` = [recheio], `next` = [{ bombom, waitsFor: ["Recheio"] }]; recheio and casquinha both pending → both in `now`; a damaged item awaiting a weighing is in `now` after the finishable ones; a damage then new weighing yields "Recheio avariado · Queimou" then "Nova pesagem de Recheio" in time order; a complement item yields "Pesagem adicional de Recheio"; a substitution without `substitutedAt` is last with `at: null`; canceled production → `now` empty, pending items `notProduced`; finished production → only `done`, ending with "Produção finalizada"; each item event carries its item.
- [ ] **Step 2: Red** — `npx vitest run src/features/productions/timeline.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Green** + `npx tsc --noEmit`.

### Task 3: Finish one item

**Files:**
- Modify: `src/features/productions/FinishProductionForm.tsx` (becomes the one-item form), `FinishProductionForm.test.tsx`

**Interfaces:**
- Produces: `export function FinishItemForm({ production, item }: { production: Production; item: ProductionItem })` — fields "Produzido (<unit label>)" (label `Produzido de ${d}`), "Validade (opcional)" (label `Validade de ${d}`), button `` `Finalizar ${d}` ``; the leftover preview is asked for `[item.id]` when the form mounts (and again when `production` changes); the leftover section and the leftover-cost choice show inside the form as today; submit sends `finishProductionItems(production.id, { items: [{ id, producedQuantity, expiresAt }], hasLeftoversInCost })`; the success toast stays "Itens finalizados." / "Produção finalizada." by the returned status; 409 handling (waiting message, shortage dialog, generic message + refresh) unchanged. `FinishProductionForm` (the multi-item form) is removed. Keep the form keyed by `${production.id}-${item.id}` at the call site so a refresh resets it.

- [ ] **Step 1: Tests** (rewrite the form tests for one item) — submits only its item with the typed quantity and expiry; asks the preview for its own id only; validation messages as today; shortage 409 opens the dialog; waiting 409 shows the waiting message.
- [ ] **Step 2: Red** — `npx vitest run src/features/productions/FinishProductionForm.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Green** + `npx tsc --noEmit` (the page still compiles: Task 4 replaces its use; if needed, render one `FinishItemForm` per finishable item in the current page as an interim).

### Task 4: The timeline screen

**Files:**
- Modify: `src/features/productions/ProductionDetailPage.tsx`, `ProductionDetailPage.test.tsx`, `src/features/productions/item-state.ts` (remove what no caller uses any more, e.g. `itemsAsTree`, `itemStateLabel`, and their tests)

**Interfaces:**
- Consumes: `timelineOf` (Task 2), `FinishItemForm` (Task 3), `ItemDetailsSheet`, `DamageItemDialog`, `SubstituteItemDialog`, `canDamage`, `canSubstitute`.
- Layout, top to bottom, under the existing breadcrumbs/title/status badges:
  - `<section aria-labelledby>` "Feito" (h2): an ordered list of `done`, each line "<time> <text>" with `formatDateTime(at)` (no time when `at` is null) and, when `item` is set and the item is `FINISHED` or `SUBSTITUTED`, its `ItemDetailsSheet` button. Shows the last 3 events; a button `` `Ver tudo (${done.length})` `` expands to all; a finished or canceled production shows all, without the button.
  - "Agora" (h2), only on an `IN_PROGRESS` production with items in `now`: one card (`<section aria-labelledby>` named by the item) per item: `ItemDetailsSheet` button + item name (h3) + `` `Previsto ${quantityOf(expectedQuantity, unit)}` `` + origin — link "da pré-pesagem" to `/pre-weighings/<id>` or text "da receita". Ready item: `FinishItemForm` (only with `PRODUCTION_CREATE`). Awaiting a weighing: text "Avariado — faça uma nova pesagem" and the existing "Nova pesagem" link as a primary button. Secondary small outline buttons where allowed today: `DamageItemDialog`, `SubstituteItemDialog`.
  - "Depois" (h2), when `next` is not empty: one muted line per entry: `ItemDetailsSheet` button + `` `${d} · aguardando ${waitsFor.join(", ")}` `` or `` `${d} · Não produzido` ``; `SubstituteItemDialog` on the line where `canSubstitute` allows and the production is in progress with permission.
  - "Cancelar produção" stays last, as today.
- Without `PRODUCTION_CREATE`: no finish forms or action buttons anywhere (receipt buttons stay).

- [ ] **Step 1: Tests** (rewrite the page tests around the sections) — bombom example: Feito lists "Produção iniciada" and "Casquinha finalizado · 48 un" with the casquinha's receipt button; Agora has one card "Recheio" with "Previsto 0,7 kg", a "Finalizar Recheio" button and the damage button; Depois shows "Bombom · aguardando Recheio"; two stages ready → two cards, finishing one sends only that item; a damaged item awaiting a weighing shows "Avariado — faça uma nova pesagem" and the "Nova pesagem" link; with 5 events only 3 show until "Ver tudo (5)" is clicked; canceled production → no Agora, Depois lines "… · Não produzido" without buttons; finished production → only Feito, all events; read-only user sees no "Finalizar" or action buttons; existing tests for the summary badges, breadcrumbs title and cancel dialog stay green.
- [ ] **Step 2: Red** — `npx vitest run src/features/productions`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Green** — `npx vitest run src/features/productions`, `npm test`, `npx tsc --noEmit`, eslint/prettier on touched files.

### Task 5: Final verification

- [ ] `npx tsc --noEmit`; `npm test`; `npm run test:integration`; `npx prisma migrate status`; `npm run openapi:dump` leaves no diff; eslint and prettier on the changed files. Paste every output.
