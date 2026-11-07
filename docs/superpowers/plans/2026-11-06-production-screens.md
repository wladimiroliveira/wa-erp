# Production Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web screens to list, start, inspect, finish and cancel productions, on top of the existing productions service.

**Architecture:** Server Component pages call `productions.service` / `pre-weighings.service` directly; client components in `src/features/productions/` mutate through Server Actions in `src/features/productions/actions.ts`, which are thin adapters (`requireUser` → `can` → zod `safeParse` → service). No service, repository, REST or `openapi.json` change.

**Tech Stack:** Next.js 16 App Router, React, react-hook-form + zod, shadcn/ui (`Table`, `AlertDialog`, `Badge`, `Checkbox`, `NativeSelect`, `NumericInput`), `ArrangeableTable`, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-05-production-screens-design.md`

## Global Constraints

- Code, file names, tests and comments in English; every on-screen text in Portuguese.
- Business rules stay in the services; actions and pages are adapters only.
- `features/productions` must not import from `features/pre-weighings`; it meets pre-weighings only through `src/server/modules/pre-weighings/pre-weighings.service`.
- Front-end types come from `src/lib/api.ts` (`import type` of zod schemas); test factories live in `src/tests/samples.ts`.
- Client screens are tested with actions mocked via `vi.mock("@/features/productions/actions", ...)`; server component pages get no RTL test.
- Failures are worded through `messageForFailure(result, byStatus)`; the server's English message never reaches the screen.
- TDD: each test is run red and its output pasted before the implementation is written.
- **No commits.** The user's rule: work stays in the tree, uncommitted, on `feat/production-screens`, until they say otherwise. Each task ends with its verification, not a commit.

## Review Focus

1. A production started by someone else meanwhile used a selected pre-weighing → start answers 409; the screen must show the message and drop the stale pre-weighing (refresh), not leave the operator retrying blindly. Test in Task 4.
2. Finish/cancel on a production another user already finished/canceled → 409; message shown, page refreshed, no success toast. Tests in Tasks 5 and 6.
3. Expiry date in the past in the finish form → refused on the client before calling the action. Test in Task 5.
4. `?status=` holding junk or `?cursor=` not a uuid → list behaves as the default (in progress), no error page. Test in Task 2 (`readStatusFilter`).
5. A user with `PRODUCTION_READ` but not `PRODUCTION_CREATE` → no "Nova produção", no finish form, no cancel button. Tests in Tasks 3 and 5.

---

### Task 1: Types, samples, actions and navigation

**Files:**
- Modify: `src/lib/api.ts` (next to the `PreWeighing*` types)
- Modify: `src/tests/samples.ts` (after `aPreWeighing`)
- Create: `src/features/productions/actions.ts`
- Modify: `src/components/layout/nav-items.ts:36` (after "Pré-pesagens")
- Test: `src/components/layout/AppShell.test.tsx`

**Interfaces:**
- Produces (types, `src/lib/api.ts`):
  - `Production = z.output<typeof productionSchema>`
  - `ProductionPage = z.output<typeof productionPageSchema>`
  - `StartProductionBody = z.input<typeof startProductionBodySchema>`
  - `FinishProductionBody = z.input<typeof finishProductionBodySchema>`
- Produces (samples): `aProduction(over?: Partial<Production>): Production` — status `IN_PROGRESS`, id `018f0000-0000-7000-8000-0000000000b0`, one item (id `018f0000-0000-7000-8000-0000000000b1`, product "Pão francês" KILOGRAM sku `...090`, `preWeighingId: null`, expected `"10"`, produced/unitCost `null`, one input "Farinha de trigo" `"6"` cost `null`), `createdAt: "2026-10-14T12:00:00.000Z"`, finished/canceled `null`. `aProductionItem(over?)` returning that item, for tests that build several items.
- Produces (actions, all `"use server"`, results shaped `{ ok: true; data: T } | Failure`):
  - `startProduction(body: StartProductionBody): Promise<ProductionResult>` — `PRODUCTION_CREATE`, `startProductionBodySchema`, service `startProduction({ ...parsed, createdById: user.id })`; on ok `revalidatePath("/productions")` and `revalidatePath("/pre-weighings")`.
  - `finishProduction(id: string, body: FinishProductionBody): Promise<ProductionResult>` — `PRODUCTION_CREATE`, parses `productionIdParamsSchema` and `finishProductionBodySchema`; on ok revalidates `/productions` and `/productions/${id}`.
  - `cancelProduction(id: string): Promise<ProductionResult>` — `PRODUCTION_CREATE`; on ok revalidates `/productions`, `/productions/${id}`, `/pre-weighings`.
  - `loadMoreProductions(status: ProductionStatus | undefined, cursor: string): Promise<ProductionPageResult>` — `PRODUCTION_READ`, `listProductionsQuerySchema`.
  - `planProductionItem(target: { productSku: string; quantity: string }): Promise<PlanResult>` — `PRODUCTION_READ`, `preWeighingPlanQuerySchema`, `previewPreWeighing`.
  - `loadMoreAvailablePreWeighings(cursor: string): Promise<PreWeighingPageResult>` — `PRODUCTION_READ`, `listPreWeighingsQuerySchema.safeParse({ cursor, available: "true" })`, `listPreWeighingsPage`.
  - Exported result types: `ProductionResult`, `ProductionPageResult`, `PlanResult`, `PreWeighingPageResult`.
  - Denials: `fail(403, "Permission denied.")`; bad input: `fail(400, "Invalid input.")` — same constants as `features/pre-weighings/actions.ts`.

- [ ] **Step 1: Write the failing test** in `AppShell.test.tsx`, next to the pre-weighings one:

```tsx
it("offers the productions to whoever may read the production", async () => {
  renderWithProviders(<AppShell>{null}</AppShell>, { user: aCurrentUser({ permissions: ["PRODUCTION_READ"] }) });

  expect(await screen.findByRole("link", { name: "Produções" })).toHaveAttribute("href", "/productions");
});
```

- [ ] **Step 2: Run** `npx vitest run --project web src/components/layout/AppShell.test.tsx` — expected FAIL, no link "Produções". Paste output.
- [ ] **Step 3: Implement** the nav item `{ to: "/productions", label: "Produções", icon: Factory, permission: "PRODUCTION_READ" }` (import `Factory` from `lucide-react`), the four types, the two sample factories and `actions.ts` per Interfaces.
- [ ] **Step 4: Run** `npx vitest run --project web src/components/layout/AppShell.test.tsx && npm run typecheck` — expected PASS and no type errors. Paste output.

---

### Task 2: List status filter

**Files:**
- Create: `src/features/productions/status-filter.ts`
- Test: `src/features/productions/status-filter.test.ts`

**Interfaces:**
- Produces:
  - `type StatusFilter = ProductionStatus | "all"`
  - `DEFAULT_STATUS_FILTER: StatusFilter = "IN_PROGRESS"`
  - `readStatusFilter(raw: unknown): StatusFilter` — a known status or `"all"` as given; anything else (absent, array, junk) → `"IN_PROGRESS"`.
  - `statusOfFilter(filter: StatusFilter): ProductionStatus | undefined` — `"all"` → `undefined`.
  - `STATUS_LABELS: Record<ProductionStatus, string>` = `{ IN_PROGRESS: "Em andamento", FINISHED: "Finalizada", CANCELED: "Cancelada" }`
  - `FILTER_LABELS: Record<StatusFilter, string>` = `{ IN_PROGRESS: "Em andamento", FINISHED: "Finalizadas", CANCELED: "Canceladas", all: "Todas" }`

- [ ] **Step 1: Write the failing tests**

```ts
describe("readStatusFilter", () => {
  it.each(["IN_PROGRESS", "FINISHED", "CANCELED", "all"])("keeps %s", (raw) => {
    expect(readStatusFilter(raw)).toBe(raw);
  });
  it.each([undefined, "", "finished", "DONE", ["FINISHED", "CANCELED"]])("reads %j as in progress", (raw) => {
    expect(readStatusFilter(raw)).toBe("IN_PROGRESS");
  });
});

describe("statusOfFilter", () => {
  it("lists every status for all", () => expect(statusOfFilter("all")).toBeUndefined());
  it("lists one status otherwise", () => expect(statusOfFilter("CANCELED")).toBe("CANCELED"));
});
```

- [ ] **Step 2: Run** `npx vitest run --project web src/features/productions/status-filter.test.ts` — expected FAIL, module not found. Paste output.
- [ ] **Step 3: Implement** `status-filter.ts`.
- [ ] **Step 4: Run** the same test — expected PASS. Paste output.

---

### Task 3: Productions list screen

**Files:**
- Create: `src/app/(app)/(production)/productions/page.tsx`
- Create: `src/features/productions/ProductionsListPage.tsx`
- Test: `src/features/productions/ProductionsListPage.test.tsx`

**Interfaces:**
- Consumes: `loadMoreProductions`, `STATUS_LABELS`, `FILTER_LABELS`, `readStatusFilter`, `statusOfFilter`, `StatusFilter`, `aProduction`.
- Produces: `ProductionsListPage({ page, filter }: { page: ProductionPage; filter: StatusFilter })`.
- Page: `filter = readStatusFilter(params.status)`; `listProductionsQuerySchema.safeParse({ cursor: params.cursor, status: statusOfFilter(filter) })`, falling back to parsing `{ status: statusOfFilter(filter) }` when refused (a bad cursor is read as none); `listProductionsPage(query)`; renders `<ProductionsListPage page={page} filter={filter} />`.
- Behavior: follows `PreWeighingsListPage` (ArrangeableTable `tableKey="productions"`, rowNoun produção/produções, "Carregar mais" appending older pages). Filter is a `NativeSelect` labelled "Status" with the four `FILTER_LABELS`; changing it does `router.replace("/productions?status=<value>")` (no `status` param for the default `IN_PROGRESS`). Columns: "Início" (`formatDateTime(createdAt)`, link to `/productions/<id>`), "Status" (`Badge`: outline for in progress, secondary finished, destructive canceled), "Produtos" (item product descriptions joined by ", "), "Itens" (count). "Nova produção" (IconButton in table actions / outline link in EmptyState) to `/productions/new` only with `PRODUCTION_CREATE` and `CATALOG_READ`. Empty: "Nenhuma produção encontrada.". Load-more failure: `toast.error(messageForFailure(result))`.

- [ ] **Step 1: Write the failing tests** (`open(page, filter = "IN_PROGRESS", permissions = ["PRODUCTION_READ"])` helper as in `PreWeighingsListPage.test.tsx`):
  - "lists each production with its start, status, products and item count": two items "Pão francês", "Pão de queijo", `createdAt "2026-10-02T12:00:00.000Z"` → row has link matching `/^02\/10\/2026/` with href `/productions/<id>`, text "Em andamento", "Pão francês, Pão de queijo", "2".
  - "says no production was found instead of a bare table": text "Nenhuma produção encontrada.", no `table`.
  - "loads older productions with the same status filter": `filter="FINISHED"`, `nextCursor "p-2"`; click "Carregar mais" → `loadMoreProductions` called with `("FINISHED", "p-2")`, new row shown, button gone. With `filter="all"` → called with `(undefined, cursor)`.
  - "filters by status through the address": `selectOptions(getByLabelText("Status"), "Canceladas")` → `navigation.url === "/productions?status=CANCELED"`; selecting "Em andamento" → `"/productions"`.
  - "offers a new production only to whoever may start one with the catalog": with `["PRODUCTION_READ","PRODUCTION_CREATE","CATALOG_READ"]` link "Nova produção" href `/productions/new`; with `["PRODUCTION_READ"]` none.
- [ ] **Step 2: Run** `npx vitest run --project web src/features/productions/ProductionsListPage.test.tsx` — expected FAIL, module not found. Paste output.
- [ ] **Step 3: Implement** the component and `productions/page.tsx`.
- [ ] **Step 4: Run** the test file and `npm run typecheck` — expected PASS. Paste output.

---

### Task 4: Start production screen

**Files:**
- Create: `src/app/(app)/(production)/productions/new/layout.tsx` (copy of `pre-weighings/new/layout.tsx`: `PRODUCTION_CREATE` + `CATALOG_READ`)
- Create: `src/app/(app)/(production)/productions/new/page.tsx`
- Create: `src/features/productions/StartProductionPage.tsx`
- Test: `src/features/productions/StartProductionPage.test.tsx`

**Interfaces:**
- Consumes: `startProduction`, `planProductionItem`, `loadMoreAvailablePreWeighings`, `aPreWeighing`, `aPreWeighingPlan`, `aProduction`, `aProduct` (existing).
- Produces: `StartProductionPage({ products, preWeighings }: { products: Product[]; preWeighings: PreWeighingPage })`.
- Page: `listProducts({ kind: ["MANUFACTURED"], status: "ACTIVE" })` and `listPreWeighingsPage(listPreWeighingsQuerySchema.parse({ available: "true" }))`.
- Behavior:
  - Section "Pré-pesagens disponíveis": one `Checkbox` per pre-weighing, accessible name `"<product> — <quantityOf> — <formatDateTime>"`; "Carregar mais" appends via `loadMoreAvailablePreWeighings(cursor)`. Empty: "Nenhuma pré-pesagem disponível.".
  - Section "Itens sem pré-pesagem": `NativeSelect` "Produto" + `NumericInput` "Quantidade" + button "Adicionar". Validates like `PreWeighingPage` target form, calls `planProductionItem({ productSku, quantity: toApiDecimal(quantity) })`. ok → a line (product, quantity, its inputs with `plannedQuantity`, and when any `shortfall !== "0"` the text "Estoque insuficiente: falta <quantityOf(shortfall)> de <ingredient>"), button "Remover" (accessible name `Remover <product>`), form reset. Failure → `role="alert"` with the `PLAN_MESSAGES` wording copied from `PreWeighingPage` (404/409).
  - Button "Iniciar produção", disabled with no checked pre-weighing and no line. Body: checked pre-weighings first as `{ preWeighingId }` in list order, then lines as `{ productSku, quantity }`. ok → `router.push("/productions/<id>")` and `toast.success("Produção iniciada.")`. Failure → `role="alert"` with `{ 404: "Uma pré-pesagem ou produto não existe mais. A lista foi atualizada.", 409: "Uma pré-pesagem já está em outra produção ou a receita mudou. A lista foi atualizada." }`, unchecks everything, `router.refresh()`.

- [ ] **Step 1: Write the failing tests:**
  - "starts a production from the checked pre-weighings and the added items": check pre-weighing A, add product "Pão francês" qty "10,5" (plan mocked ok) → click "Iniciar produção" → `startProduction` called with `{ items: [{ preWeighingId: A.id }, { productSku: <sku>, quantity: "10.5" }] }`; `navigation.pathname === "/productions/<new id>"`.
  - "does not start a production with nothing in it": button "Iniciar produção" disabled initially.
  - "shows the inputs an added item plans and warns of what the stock lacks": plan with ingredient shortfall `"1.5"` KILOGRAM "Farinha de trigo" → text "Estoque insuficiente: falta 1,5 kg de Farinha de trigo".
  - "does not add an item whose plan is refused": plan → `{ ok:false, status:409, message:"x" }` → alert contains "o produto não tem receita"; no "Remover" button.
  - "removes an added item": after add, click "Remover Pão francês" → button gone and "Iniciar produção" disabled.
  - "explains a pre-weighing taken meanwhile and unchecks it": start → `{ ok:false, status:409 }` → alert "Uma pré-pesagem já está em outra produção ou a receita mudou. A lista foi atualizada."; checkbox unchecked.
  - "loads more available pre-weighings": `nextCursor "c-1"` → click "Carregar mais" → `loadMoreAvailablePreWeighings("c-1")`, new checkbox shown.
- [ ] **Step 2: Run** `npx vitest run --project web src/features/productions/StartProductionPage.test.tsx` — expected FAIL. Paste output.
- [ ] **Step 3: Implement** component, layout and page. Split the free-item adder into `FreeItemForm` inside the same file only if the file passes ~300 lines; otherwise keep one file.
- [ ] **Step 4: Run** the test file and `npm run typecheck` — expected PASS. Paste output.

---

### Task 5: Production detail screen and finish form

**Files:**
- Create: `src/app/(app)/(production)/productions/[id]/page.tsx` (like `pre-weighings/[id]/page.tsx`, with `productionIdParamsSchema` + `getProduction`)
- Create: `src/features/productions/ProductionDetailPage.tsx`
- Create: `src/features/productions/FinishProductionForm.tsx`
- Test: `src/features/productions/ProductionDetailPage.test.tsx`
- Test: `src/features/productions/FinishProductionForm.test.tsx`

**Interfaces:**
- Consumes: `finishProduction`, `STATUS_LABELS`, `quantityOf`, `moneyOf`, `formatDateTime`, `todayIso`, `positiveDecimal`, `toApiDecimal`, `aProduction`, `aProductionItem`.
- Produces:
  - `ProductionDetailPage({ production }: { production: Production })` — back link "Voltar para as produções" → `/productions`; title "Produção de <formatDateTime(createdAt)>"; summary `dl` (Status, Iniciada em, and "Finalizada em" / "Cancelada em" when set). One section per item headed by the product description, with origin ("Pré-pesagem" link to `/pre-weighings/<id>` or text "Receita"), "Previsto", "Produzido", "Custo unitário" (`quantityOf`/`moneyOf`, `—` when null), then a table of inputs (Insumo, Quantidade, Custo unitário). When `IN_PROGRESS` and the user can `PRODUCTION_CREATE`: renders `<FinishProductionForm production={production} />` and `<CancelProductionDialog productionId={production.id} />` (Task 6; add the dialog in Task 6).
  - `FinishProductionForm({ production }: { production: Production })` — one row per item: `NumericInput` labelled "Produzido de <product>" (blank default, `positiveDecimal` messages "Informe o produzido, com até 6 casas decimais." / "O produzido deve ser maior que zero.") and date input labelled "Validade de <product>" (optional; when filled must be `>= todayIso()`, message "A validade não pode estar no passado."). Button "Finalizar produção". Body `{ items: [{ id, producedQuantity: toApiDecimal(v), expiresAt: date || null }] }`. ok → `toast.success("Produção finalizada.")`, `router.refresh()`. Failure → `role="alert"` with `{ 404: "Essa produção não existe mais.", 409: "A produção já foi finalizada ou cancelada, ou o custo ficou fora do limite. A página foi atualizada." }` and `router.refresh()` on 409.

- [ ] **Step 1: Write the failing tests**
  - Detail: "shows each item with its origin, quantities and inputs" (one guided item with `preWeighingId` → link "Pré-pesagem" href `/pre-weighings/<id>`; one free → text "Receita"; "10 kg" expected, "Farinha de trigo" input row).
  - Detail: "shows the costs of a finished production" (`FINISHED`, produced `"9.5"`, unitCost `"2.5"`, input unitCost `"1.2"` → "9,5 kg", `moneyOf("2.5")`, `moneyOf("1.2")`, "Finalizada em").
  - Detail: "offers finishing only while in progress and to whoever may record production" (in progress + `PRODUCTION_CREATE` → button "Finalizar produção"; `FINISHED` → none; `["PRODUCTION_READ"]` only → none).
  - Form: "finishes with what each item produced and its expiry" (type "9,5" + date `2099-01-31` → `finishProduction("<id>", { items: [{ id: <item id>, producedQuantity: "9.5", expiresAt: "2099-01-31" }] })`, toast).
  - Form: "sends no expiry when none is given" (`expiresAt: null`).
  - Form: "refuses a blank produced quantity and an expiry in the past without calling the server" (messages above; `finishProduction` not called).
  - Form: "explains a production finished meanwhile" (409 → alert text above).
- [ ] **Step 2: Run** `npx vitest run --project web src/features/productions/ProductionDetailPage.test.tsx src/features/productions/FinishProductionForm.test.tsx` — expected FAIL. Paste output.
- [ ] **Step 3: Implement** detail page component, finish form and the `[id]/page.tsx`.
- [ ] **Step 4: Run** both test files and `npm run typecheck` — expected PASS. Paste output.

---

### Task 6: Cancel dialog

**Files:**
- Create: `src/features/productions/CancelProductionDialog.tsx`
- Test: `src/features/productions/CancelProductionDialog.test.tsx`
- Modify: `src/features/productions/ProductionDetailPage.tsx` (render the dialog next to the finish form)

**Interfaces:**
- Consumes: `cancelProduction`.
- Produces: `CancelProductionDialog({ productionId }: { productionId: string })` — trigger button "Cancelar produção" (variant destructive outline) opening an `AlertDialog` titled "Cancelar esta produção?" with description "As pré-pesagens usadas voltam a ficar disponíveis. O estoque não é alterado." and actions "Voltar" / "Cancelar produção". Same transition/failure shape as `DeleteRoleDialog`. ok → `toast.success("Produção cancelada.")`, `router.refresh()`, close. Failure → alert in the dialog with `{ 404: "Essa produção não existe mais.", 409: "A produção já foi finalizada ou cancelada. A página foi atualizada." }`, `router.refresh()`.

- [ ] **Step 1: Write the failing tests:** "cancels after confirmation" (`cancelProduction` called with the id only after clicking the dialog's "Cancelar produção"); "does nothing when the operator goes back" (click "Voltar" → not called); "explains a production already closed" (409 → alert text). Plus in `ProductionDetailPage.test.tsx`: the in-progress/permission test also expects button "Cancelar produção" present/absent.
- [ ] **Step 2: Run** `npx vitest run --project web src/features/productions` — expected FAIL on the new tests. Paste output.
- [ ] **Step 3: Implement** the dialog and render it in the detail page.
- [ ] **Step 4: Run** `npx vitest run --project web src/features/productions src/components/layout && npm run typecheck && npx eslint src/features/productions "src/app/(app)/(production)/productions" src/components/layout src/lib/api.ts src/tests/samples.ts && npx prettier --check src/features/productions "src/app/(app)/(production)/productions" docs/superpowers` — expected all PASS. Paste output.
