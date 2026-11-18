# Intermediate Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-weigh a manufactured product together with the intermediates it takes (ready, produce,
or partly ready), produce each intermediate into stock, and finish the final product only once its
intermediates are produced and in stock — with a shortage dialog offering a new weighing or a
reduction.

**Architecture:** A pre-weighing becomes a tree through `PreWeighing.parentId`; the plan is built
recursively by one stage function in `pre-weighings.service`. Each node guides an ordinary
production item. `productions.service` adds three guards (no node with its descendant in one
production, children finished before the parent finishes, intermediate stock covers the inputs) and a
reduce operation that scales an item's inputs. Cost, lot and leftover logic are untouched.

**Tech Stack:** Next.js App Router route handlers (`apiHandler`), Prisma/Postgres, zod v4, Vitest
(api, web/jsdom, integration), React Testing Library, react-hook-form.

**Spec:** `docs/superpowers/specs/2026-11-12-intermediate-products-design.md`

## Global Constraints

- Code, identifiers, comments, tests in English; only screen texts in Portuguese (pt-BR).
- TDD: write the test, run it, paste the red output, then implement.
- **No commits and no push unless the user orders it.** Each task ends leaving its changes in the
  tree; the "Checkpoint" step replaces the usual commit.
- Business rules live in services; `route.ts` and `actions.ts` are adapters only. Every route
  declares `auth` (`Permission.PRODUCTION_READ` for reads, `Permission.PRODUCTION_CREATE` for writes).
- Front-end types only via `import type` in `src/lib/api.ts`; test factories in `src/tests/samples.ts`.
- Quantities: stored at 6 places (`toStoredDecimal`); quantities the operator picks are whole for
  `UNIT` and 3 places otherwise.
- `/v1` may change shape; `openapi.json` is regenerated with `npm run openapi:dump`, never edited.
- Default `toProduce` = `max(0, needed − inStock)`.
- Shortage 409 body: `{ message, shortages: [{ itemId, product, needed, available }], items: [{ itemId, maxQuantity }] }`;
  pending 409 body: `{ message, pendingPreWeighings: [{ id, product }] }`.
- Query parameter for the plan: `produce=<sku>:<quantity>`, repeated.

## Review Focus

1. **`UNIT` intermediates** (casquinha counted in units): `maxQuantity` and default `toProduce`
   must not produce fractional units where the operator picks — test in Task 1 and Task 6.
2. **The same intermediate at two places of the tree** (recheio taken by the bombom and by the
   casquinha): one `produce` entry applies to both; the shortage check sums both inputs — tests in
   Task 2 and Task 6.
3. **A complement whose parent's production already finished or whose recipe does not take the
   product**: refused with 409, nothing written — test in Task 3.
4. **A stale plan on record**: the operator changed `toProduce` after the preview and the stage sent
   does not match the re-plan → 409, nothing written — test in Task 3.
5. **Reducing twice, or reducing an item guided by a node with children**: scales from the current
   expected quantity each time, child stages unaffected — test in Task 7.

---

### Task 1: Pure quantity helpers

**Files:**
- Modify: `src/server/lib/decimal.ts` (add `pickPlacesOf`)
- Modify: `src/server/modules/pre-weighings/pre-weighings.plan.ts` (use `pickPlacesOf` in `suggestQuantities`; add `defaultToProduce`)
- Create: `src/server/modules/productions/production-reduction.ts`
- Test: `src/server/modules/pre-weighings/pre-weighings.plan.test.ts`, `src/server/modules/productions/production-reduction.test.ts`

**Interfaces:**
- Produces:
  - `pickPlacesOf(unit: MeasurementUnit): 0 | 3` — places of a quantity the operator picks.
  - `defaultToProduce(needed: Prisma.Decimal, inStock: Prisma.Decimal): Prisma.Decimal`
  - `scaleInputs<T extends { quantity: Prisma.Decimal }>(inputs: T[], from: Prisma.Decimal, to: Prisma.Decimal): T[] | null` — each quantity × to ÷ from at stored precision; null if any rounds to 0.
  - `maxQuantityFromStock(input: { expected: Prisma.Decimal; unit: MeasurementUnit; needs: { needed: Prisma.Decimal; available: Prisma.Decimal }[] }): Prisma.Decimal` — `min(expected, min over needs of expected × available ÷ needed)`, rounded down to `pickPlacesOf(unit)`, never below 0.

- [ ] **Step 1: Write the failing tests**

```ts
// pre-weighings.plan.test.ts
describe("defaultToProduce", () => {
  it("is the shortfall", () => expect(defaultToProduce(D("2.5"), D("1")).toString()).toBe("1.5"));
  it("is zero when the stock covers it", () => expect(defaultToProduce(D("1"), D("3")).toString()).toBe("0"));
  it("is the whole need when the stock is negative", () => expect(defaultToProduce(D("1"), D("-2")).toString()).toBe("1"));
});

// production-reduction.test.ts
describe("scaleInputs", () => {
  it("scales every input by the ratio", () =>
    expect(scaleInputs([{ productSku: "a", quantity: D("10") }, { productSku: "b", quantity: D("0.3") }], D("100"), D("90"))
      .map((i) => i.quantity.toString())).toEqual(["9", "0.27"]));
  it("is null when an input rounds to nothing", () =>
    expect(scaleInputs([{ productSku: "a", quantity: D("0.000001") }], D("100"), D("1"))).toBeNull());
});
describe("maxQuantityFromStock", () => {
  it("is limited by the scarcest input, rounded down to 3 places", () =>
    expect(maxQuantityFromStock({ expected: D("10"), unit: "KILOGRAM",
      needs: [{ needed: D("3"), available: D("2") }, { needed: D("1"), available: D("5") }] }).toString()).toBe("6.666"));
  it("is whole for units", () =>
    expect(maxQuantityFromStock({ expected: D("100"), unit: "UNIT", needs: [{ needed: D("1.5"), available: D("1.4") }] }).toString()).toBe("93"));
  it("never exceeds the expected quantity", () =>
    expect(maxQuantityFromStock({ expected: D("10"), unit: "UNIT", needs: [{ needed: D("1"), available: D("50") }] }).toString()).toBe("10"));
  it("is zero when nothing is available", () =>
    expect(maxQuantityFromStock({ expected: D("10"), unit: "UNIT", needs: [{ needed: D("1"), available: D("-1") }] }).toString()).toBe("0"));
});
```
(`D = (v: string) => new Prisma.Decimal(v)`.)

- [ ] **Step 2: Run** `npx vitest run --project api src/server/modules/pre-weighings/pre-weighings.plan.test.ts src/server/modules/productions/production-reduction.test.ts` — Expected: FAIL (functions not exported / module not found). Paste output.
- [ ] **Step 3: Implement** the four functions with the signatures above; replace the local `places` expression in `suggestQuantities` with `pickPlacesOf(unit)`.
- [ ] **Step 4: Run** the same command — Expected: PASS, and the existing `suggestQuantities` tests still pass.
- [ ] **Step 5: Checkpoint** — `npx tsc --noEmit` clean; leave changes in the tree.

---

### Task 2: Recursive plan and its preview route

**Files:**
- Modify: `src/server/modules/pre-weighings/pre-weighings.repository.ts` (`findProductWithRecipe` selects `kind` and `stock.quantity` of ingredients)
- Modify: `src/server/modules/pre-weighings/pre-weighings.service.ts` (`planPreWeighing`, `previewPreWeighing`)
- Modify: `src/server/modules/pre-weighings/pre-weighings.schemas.ts` (`produce` query, recursive plan schema)
- Modify: `src/app/v1/pre-weighings/plan/route.ts`
- Modify: `src/server/modules/productions/productions.service.ts` (`planItem` passes no `produce`; free items keep today's behavior)
- Test: `src/server/modules/pre-weighings/pre-weighings.routes.integration.test.ts`

**Interfaces:**
- Consumes: `defaultToProduce` (Task 1).
- Produces:
  - `planPreWeighing(productSku: string, quantity: string | Prisma.Decimal, produce?: ReadonlyMap<string, Prisma.Decimal>): Promise<Result<PreWeighingPlan, 404 | 409>>` where each `PreWeighingPlan["items"][n]` gains `manufactured: { inStock: Prisma.Decimal; toProduce: Prisma.Decimal; stage: PreWeighingPlan | null } | null` (null for `GOODS`; `stage` null when `toProduce` is 0). `produce` keys are lower-case SKUs and apply at every depth.
  - `previewPreWeighing(productSku, quantity, tolerance = 20, produce?)` — each manufactured item presents `manufactured: { needed, inStock, toProduce, stage }` with `stage` the same preview shape (lots, shortfall, waste), recursive.
  - `preWeighingPlanQuerySchema` gains `produce`: string or string[] of `<uuid>:<positive-or-zero decimal>` → `Map<string, Prisma.Decimal>`; a SKU listed twice is a 400.
  - `preWeighingPlanSchema` becomes recursive (zod v4 getter: `get stage() { return preWeighingPlanSchema.nullable(); }`), registered with `.meta({ id: "PreWeighingPlan" })` so the OpenAPI dump emits a `$ref`.

- [ ] **Step 1: Write the failing integration tests** (fixture: bombom 10 UNIT ← recheio 0.2 kg + casquinha 10 UNIT + granulado 0.05 kg; recheio 1 kg ← leite condensado 0.8 kg + chocolate 0.2 kg; casquinha 100 UNIT ← chocolate 1 kg; seed recheio stock 0.3 kg via a lot)
  - `it("plans each intermediate's shortfall by default")` — GET plan for 50 bombons: recheio item `manufactured` = `{ needed: "1", inStock: "0.3", toProduce: "0.7" }`, `stage.quantity === "0.7"`, `stage.items` = leite condensado `"0.56"`, chocolate `"0.14"`; casquinha `toProduce === "50"`; granulado `manufactured === null`.
  - `it("takes ready material when told to produce nothing")` — `produce=<recheio>:0` → recheio `toProduce "0"`, `stage null`.
  - `it("produces more than needed when told to")` — `produce=<recheio>:2` → `stage.quantity "2"`.
  - `it("plans an intermediate of an intermediate")` — casquinha's recipe takes a manufactured "chocolate temperado"; its stage appears under the casquinha stage.
  - `it("applies one produce entry wherever the intermediate appears")` — recheio taken by bombom and by casquinha; both get the same `toProduce` from one `produce` entry.
  - `it("refuses a plan whose intermediate has no recipe")` → 409 `"Product has no recipe."`.
  - `it("refuses a product listed twice in produce")` → 400.
- [ ] **Step 2: Run** `npx vitest run --project integration src/server/modules/pre-weighings/pre-weighings.routes.integration.test.ts` — Expected: FAIL on the new tests only. Paste output.
- [ ] **Step 3: Implement** — `planPreWeighing` plans the current stage as today, then for each `MANUFACTURED` ingredient computes `inStock` (stock quantity or 0), `toProduce` (`produce.get(sku) ?? defaultToProduce(planned, inStock)`) and, when `toProduce > 0`, recurses with the same `produce`. Recipes are acyclic, so no depth guard. `previewPreWeighing` applies lots and waste per stage through one recursive helper. Route passes `request.query.produce`.
- [ ] **Step 4: Run** the integration file and `npx vitest run --project api src/server/modules/pre-weighings` — Expected: PASS, existing tests green.
- [ ] **Step 5: Checkpoint** — `npx tsc --noEmit` clean.

---

### Task 3: Migration, recording the tree, complements, presentation

**Files:**
- Modify: `prisma/schema.prisma` (spec "Data" block verbatim)
- Create: `prisma/migrations/20261112000000_add_pre_weighing_stages/migration.sql` (via `npx prisma migrate dev --name add_pre_weighing_stages --create-only`, then rename the folder to that timestamp)
- Modify: `pre-weighings.repository.ts` (`insertPreWeighingTree`, select `parent`, `children`)
- Modify: `pre-weighings.service.ts` (`recordPreWeighing`, `presentPreWeighing`)
- Modify: `pre-weighings.schemas.ts` (`createPreWeighingBodySchema`, `preWeighingSchema`)
- Modify: `src/server/modules/productions/productions.service.ts` (`planItem`: input quantity = `weighedQuantity ?? plannedQuantity`)
- Test: `pre-weighings.routes.integration.test.ts`, `pre-weighings.service.test.ts`

**Interfaces:**
- Consumes: `planPreWeighing` with `produce` (Task 2).
- Produces:
  - Body: `stageBodySchema = { productSku, quantity, items: [{ productSku, weighedQuantity? }], stages: stageBody[] (default []) }`; `createPreWeighingBodySchema = stageBodySchema.extend({ parentId: z.uuid().optional() })`.
  - `recordPreWeighing(input: StageBody & { parentId?: string; createdById: string }): Promise<Result<PresentedPreWeighing, 404 | 409>>` — re-plans with `produce` built from `stages` (each stage's `productSku → quantity`, recursively; ingredients without a stage → 0), checks every stage, inserts in one transaction, returns the root.
  - `insertPreWeighingTree(tree: PlannedStage, input: { createdById: string; parentId: string | null }): Promise<PreWeighingRecord>`
  - `PresentedPreWeighing` gains `parent: { id, product } | null`, `children: { id, product, quantity }[]`, items' `weighedQuantity: string | null`.
  - `PlannedProductionItem.inputs` for a guided item uses `plannedQuantity` when `weighedQuantity` is null.

- [ ] **Step 1: Write the failing tests** (fixture from Task 2)
  - `it("records the bombom and its intermediates in one call")` — POST tree; 201; root `children` lists recheio (0.7) and casquinha (50); `GET` each child shows `parent.id === root.id`; the recheio line of the root has `weighedQuantity: null`.
  - `it("refuses a weighing on a manufactured line")` → 409 `"The items do not match the ingredients of the recipe."`, `testPrisma.preWeighing.count() === 0`.
  - `it("refuses a stage that does not match the plan")` — recheio stage quantity "0.7" but its items weighed for "0.5" plan, or a stage for a GOODS ingredient → 409, count 0.
  - `it("refuses a bought ingredient left unweighed")` → 409, count 0.
  - `it("records a complement under an existing pre-weighing")` — POST `{ parentId: root.id, productSku: recheio, quantity: "0.2", items }` → 201, `parent.id === root.id`; root now lists 3 children.
  - `it("refuses a complement whose parent does not take that product")` → 409 `"The parent's recipe does not take this product."`.
  - `it("refuses a complement whose parent's production has finished")` → 409 `"The parent's production has already finished."`.
  - `it("refuses a complement under a missing pre-weighing")` → 404 `"Pre-weighing not found."`.
  - Productions integration: `it("guides an unweighed line by what was planned")` — start a production from the root; the recheio input quantity equals the planned `"1"`.
- [ ] **Step 2: Run** the pre-weighings integration file (before the migration exists) — Expected: FAIL. Paste output.
- [ ] **Step 3: Implement** — schema + migration (`ALTER TABLE pre_weighings ADD COLUMN parent_id uuid REFERENCES pre_weighings(id) ON DELETE RESTRICT`, index, `ALTER TABLE pre_weighing_items ALTER COLUMN weighed_quantity DROP NOT NULL`); `npx prisma migrate dev` against the dev DB and `npm run db:generate`. Recording uses `prisma.$transaction` and nested creates per node.
- [ ] **Step 4: Run** the pre-weighings and productions integration files + `npx vitest run --project api src/server/modules/pre-weighings` — Expected: PASS.
- [ ] **Step 5: Checkpoint** — `npx tsc --noEmit` clean.

---

### Task 4: Failures that carry details

**Files:**
- Modify: `src/server/lib/result.ts`
- Test: `src/server/lib/result.test.ts` (create if missing)

**Interfaces:**
- Produces: `Failure<S>` gains `details?: Record<string, unknown>`; `failWith<S extends FailureStatus, D extends Record<string, unknown>>(status: S, message: string, details: D): Failure<S> & { details: D }`.

- [ ] **Step 1: Test** `it("keeps the details of a refusal")` — `failWith(409, "x", { a: 1 })` equals `{ ok: false, status: 409, message: "x", details: { a: 1 } }`.
- [ ] **Step 2: Run** `npx vitest run --project api src/server/lib/result.test.ts` — FAIL. Paste.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 5: Production start refuses a node with its descendant

**Files:**
- Modify: `src/server/modules/pre-weighings/pre-weighings.repository.ts` (`findAncestorIds`)
- Modify: `src/server/modules/productions/productions.service.ts` (`startProduction`)
- Test: `src/server/modules/productions/productions.routes.integration.test.ts`

**Interfaces:**
- Produces: `findAncestorIds(id: string): Promise<string[]>` — recursive CTE over `parent_id`, nearest first.

- [ ] **Step 1: Tests**
  - `it("refuses a pre-weighing together with one of its descendants")` — start with root and recheio child → 409 `"A pre-weighing cannot be produced together with one of its intermediates."`, no production created.
  - `it("refuses a pre-weighing together with a grandchild")` — root and the chocolate-temperado stage.
  - `it("starts siblings together")` — recheio and casquinha children → 201 with two items.
- [ ] **Step 2: Run** the productions integration file — new tests FAIL. Paste.
- [ ] **Step 3: Implement** — after planning items, for each guided id collect ancestors; refuse if any ancestor is among the guided ids.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 6: Finish guards — pending children and shortage

**Files:**
- Modify: `src/server/modules/stock/stock.repository.ts` (`holdStockBalances` also returns `productSku`)
- Modify: `src/server/modules/pre-weighings/pre-weighings.repository.ts` (`findChildrenProgress`)
- Modify: `src/server/modules/productions/productions.service.ts` (`finishProduction`)
- Modify: `src/server/modules/productions/productions.schemas.ts` (`finishConflictSchema`)
- Modify: `src/app/v1/productions/[id]/finish/route.ts` (409 → `{ message, ...result.details }`, response `409: finishConflictSchema`)
- Test: `productions.routes.integration.test.ts`

**Interfaces:**
- Consumes: `failWith` (Task 4), `maxQuantityFromStock` (Task 1), `PreWeighingRecord.children` (Task 3).
- Produces:
  - `findChildrenProgress(preWeighingIds: string[]): Promise<{ id: string; parentId: string; product: ProductSummary; status: ProductionStatus | null }[]>` — `status` of the production whose item the child guides; null when none.
  - `finishConflictSchema = messageSchema.extend({ pendingPreWeighings: z.array(z.object({ id: z.uuid(), product: productSummarySchema })).optional(), shortages: z.array(z.object({ itemId: z.uuid(), product: productSummarySchema, needed: z.string(), available: z.string() })).optional(), items: z.array(z.object({ itemId: z.uuid(), maxQuantity: z.string() })).optional() })`.
  - `finishProduction` failures: `failWith(409, "An intermediate has not been produced yet.", { pendingPreWeighings })` and `failWith(409, "Not enough of an intermediate in stock.", { shortages, items })`.

- [ ] **Step 1: Tests**
  - `it("refuses to finish the bombom before its intermediates")` — root production in progress, recheio not started → 409 with `pendingPreWeighings[0].product.sku === recheio`; no stock movement.
  - `it("counts a canceled intermediate as pending")`.
  - `it("refuses to finish when the intermediate yielded less")` — finish recheio with 0.5 instead of 0.7 (stock 0.8, need 1) → bombom finish 409; `shortages[0]` = `{ needed: "1", available: "0.8" }`, `items[0].maxQuantity === "40"`; no movement created by the bombom.
  - `it("sums an intermediate taken by two items of the production")` — two items each needing 0.5 recheio, stock 0.8 → 409.
  - `it("finishes once the intermediates are in stock")` — full run: recheio, casquinha finished; bombom finishes; its `unitCost` equals (cost of recheio lot × 1 + casquinha × 50 + granulado) ÷ produced; recheio stock back to 0.
  - Existing tests for productions without stages stay green.
- [ ] **Step 2: Run** the productions integration file — new tests FAIL. Paste.
- [ ] **Step 3: Implement** — inside the transaction, right after `markProductionFinished` and `holdStockBalances` (which now yields balances by SKU): (1) pending check for items whose pre-weighing has children (`status !== FINISHED`); (2) sum inputs per manufactured SKU across items, compare to the held balance, build `shortages` per item and `maxQuantityFromStock` per short item; throw `ProductionAborted` with the `failWith` result. The input's product needs `kind` in `productionSelect`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Checkpoint** — `npx tsc --noEmit` clean.

---

### Task 7: Reduce a production item

**Files:**
- Modify: `productions.repository.ts` (`lockProductionInProgress`, `rescaleProductionItem`)
- Modify: `productions.service.ts` (`reduceProductionItem`)
- Modify: `productions.schemas.ts` (`productionItemParamsSchema`, `reduceProductionItemBodySchema`)
- Create: `src/app/v1/productions/[id]/items/[itemId]/reduce/route.ts` (`POST`, `auth: Permission.PRODUCTION_CREATE`, tags `["productions"]`, summary `"Reduz a quantidade esperada de um item e escala os insumos na mesma proporção"`, responses 200 `productionSchema`, 404/409 `messageSchema`)
- Test: `productions.routes.integration.test.ts`

**Interfaces:**
- Consumes: `scaleInputs`, `pickPlacesOf` (Task 1).
- Produces: `reduceProductionItem(input: { productionId: string; itemId: string; quantity: string }): Promise<ProductionResult>`; `productionItemParamsSchema = z.object({ id: z.uuid(), itemId: z.uuid() })`; `reduceProductionItemBodySchema = z.object({ quantity: positiveDecimalSchema })`.

- [ ] **Step 1: Tests**
  - `it("reduces the item and scales every input")` — 50 → 40: expected `"40"`, granulado `"0.25"` → `"0.2"`, recheio `"1"` → `"0.8"`.
  - `it("reduces again from the current quantity")` — 40 → 20: recheio `"0.4"`.
  - `it("then finishes with what the stock has")` — after reducing to 40, finish passes.
  - `it("refuses a quantity not below the expected one")`, `it("refuses fractional units")` (`"39.5"` on UNIT) → 409.
  - `it("refuses a production not in progress")` → 409 `"Production is not in progress."`; `it("refuses an item of another production")` → 404 `"Production item not found."`.
  - `it("refuses when an input would round to nothing")` → 409 `"Quantity is out of range for this recipe."`.
- [ ] **Step 2: Run** — FAIL. Paste.
- [ ] **Step 3: Implement** — one transaction: `lockProductionInProgress` (`SELECT … FOR UPDATE` where status IN_PROGRESS, returns boolean), validate, `scaleInputs`, `rescaleProductionItem` updates `expectedQuantity` and each input.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Checkpoint** — `npx tsc --noEmit`, `npm run openapi:dump` (inspect that `PreWeighingPlan` is a `$ref` and the new route appears).

---

### Task 8: Client types, actions, samples

**Files:**
- Modify: `src/lib/api.ts` (export `FinishConflict = z.output<typeof finishConflictSchema>`, `PreWeighingStageBody`, keep existing names)
- Modify: `src/features/pre-weighings/actions.ts` (`planPreWeighing(target, tolerance?, produce?: Record<string, string>)` → builds `produce` as `"<sku>:<qty>"[]`)
- Modify: `src/features/productions/actions.ts` (`finishProduction` result `FinishProductionResult = ProductionResult | (Failure<409> & { details: FinishConflict })`; new `reduceProductionItem(id: string, itemId: string, quantity: string): Promise<ProductionResult>`)
- Modify: `src/tests/samples.ts` (`aPreWeighingPlan` items with `manufactured: null`; `aPreWeighing` with `parent: null, children: []`)
- Create: `src/features/pre-weighings/plan-tree.ts` + test

**Interfaces:**
- Produces:
  - `type WeighingRow = { path: string[]; product: ProductSummary; plannedQuantity: string }` — `path` = SKUs of the stages from the root.
  - `weighingRowsOf(plan: PreWeighingPlan): WeighingRow[]` — every bought line of every stage, depth first, manufactured lines excluded.
  - `createBodyOf(plan: PreWeighingPlan, weighed: string[], parentId?: string): CreatePreWeighingBody` — `weighed[i]` belongs to `weighingRowsOf(plan)[i]`; manufactured lines sent without `weighedQuantity`; a stage per manufactured line with a non-null stage.

- [ ] **Step 1: Tests** (`plan-tree.test.ts`, web project): rows of a two-level plan in order; body round-trip puts each weighed value in its stage and omits `weighedQuantity` on manufactured lines; `parentId` passed through.
- [ ] **Step 2: Run** `npx vitest run --project web src/features/pre-weighings/plan-tree.test.ts` — FAIL. Paste.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Checkpoint.**

---

### Task 9: Pre-weighing screen with stages and complements

**Files:**
- Create: `src/features/pre-weighings/PreWeighingStage.tsx` (recursive block: item table, lots, `WasteSection`, nested stages)
- Modify: `src/features/pre-weighings/PreWeighingPage.tsx`
- Modify: `src/app/(app)/(production)/pre-weighings/new/page.tsx` (reads `parentId`, `productSku`, `quantity` search params; passes `complement?: { parentId: string; productSku: string; quantity: string }`)
- Test: `src/features/pre-weighings/PreWeighingPage.test.tsx`

**Interfaces:**
- Consumes: `weighingRowsOf`, `createBodyOf` (Task 8); `planPreWeighing(target, tolerance, produce)`.
- Produces: `PreWeighingPage` prop `complement?`.

Screen texts: column headers `Necessário`, `No estoque`, `A fabricar`; stage heading `Fabricar {quantity} de {description}`; complement banner `Complemento da pré-pesagem de {parent description}`.

- [ ] **Step 1: Tests**
  - `it("shows needed, in stock and to produce on an intermediate")` — plan with recheio manufactured; no weighing field on that line.
  - `it("re-plans when the quantity to produce changes")` — type `0,5` in `A fabricar`, `planPreWeighing` called with `{ [recheio]: "0.5" }`.
  - `it("weighs the ingredients of every stage")` — fields for the stage's leite condensado and chocolate.
  - `it("sends the tree")` — `createPreWeighing` called with the body from `createBodyOf`.
  - `it("records a complement")` — with `complement`, target prefilled and locked, banner shown, body carries `parentId`.
- [ ] **Step 2: Run** `npx vitest run --project web src/features/pre-weighings/PreWeighingPage.test.tsx` — FAIL. Paste.
- [ ] **Step 3: Implement** — weighing form array follows `weighingRowsOf(plan)`; `produce` state keyed by SKU, debounced re-plan like the quantity.
- [ ] **Step 4: Run** — PASS, existing tests green.
- [ ] **Step 5: Checkpoint.**

---

### Task 10: Detail and start-production hints

**Files:**
- Modify: `src/features/pre-weighings/PreWeighingDetailPage.tsx` (link `Para: {parent description}` → `/pre-weighings/{id}`; list `Intermediários`; an unweighed line shows `do estoque`)
- Modify: `src/features/productions/StartProductionPage.tsx` (available child shows `→ para {parent description}`)
- Test: the two matching `.test.tsx`

- [ ] **Step 1: Tests** — one per text above, with `aPreWeighing({ parent: …, children: […] })`.
- [ ] **Step 2: Run** — FAIL. Paste.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 11: Finish form — pending message and shortage dialog

**Files:**
- Create: `src/features/productions/ShortageDialog.tsx`
- Modify: `src/features/productions/FinishProductionForm.tsx`
- Test: `src/features/productions/FinishProductionForm.test.tsx`, `src/features/productions/ShortageDialog.test.tsx`

**Interfaces:**
- Consumes: `finishProduction` (`FinishProductionResult`), `reduceProductionItem` (Task 8).
- Produces: `ShortageDialog({ production, conflict, onClose, onReduced }: { production: Production; conflict: FinishConflict; onClose(): void; onReduced(production: Production): void })`.

Screen texts: pending → `Produza antes: {descriptions joined by ", "}.`; dialog title `Falta material intermediário`; per row `{description}: precisa {needed}, tem {available}`; buttons `Nova pesagem` (link `/pre-weighings/new?parentId={item.preWeighingId}&productSku={sku}&quantity={needed − available}`) and `Reduzir`; reduce field label `Nova quantidade`, starts at `maxQuantity`.

- [ ] **Step 1: Tests**
  - `it("names what has to be produced first")`.
  - `it("opens the shortage dialog with what is missing")`.
  - `it("links a new weighing for the missing quantity")` — href asserted.
  - `it("reduces from the maximum the stock allows")` — `reduceProductionItem` called with `("p1", "i1", "40")`; `onReduced` receives the production.
  - `it("hides Nova pesagem on an item without a pre-weighing")` (free item).
- [ ] **Step 2: Run** `npx vitest run --project web src/features/productions` — FAIL. Paste.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 12: Final verification

- [ ] Run `npm run openapi:dump` and check `git diff --stat openapi.json` shows the new shapes.
- [ ] Run `npx tsc --noEmit`, `npm run lint:eslint:check`, `npm run lint:prettier:check`, `npm test`, `npm run test:integration`; paste each output.
- [ ] Report to the user; no commit or push without their order.
