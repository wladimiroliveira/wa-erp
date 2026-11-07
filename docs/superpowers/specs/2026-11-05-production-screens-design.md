# Production screens — design

Date: 2026-11-05
Branch: `feat/production-screens`

## Goal

Give the web app the production screens: list, start, detail, finish and cancel. The back-end is
already complete (`src/server/modules/productions`, `/v1/productions`); this work only adds the
web adapters (Server Actions, pages, client components) on top of the existing services. No
business rule changes, no REST changes, `openapi.json` untouched.

## Decisions

- A production may mix both kinds of items the API accepts: **guided** (an available
  pre-weighing) and **free** (manufactured product + quantity, inputs planned from the recipe).
- Stock shortfall in a free item's plan is a **warning only**; the server does not block starting
  a production and the screen does not invent that rule.
- The finish form starts **blank**: what gets recorded is what was really produced, never the
  expected quantity left untouched (same principle as the pre-weighing form).
- Costs (item unit cost, input unit cost) are shown to anyone with `PRODUCTION_READ`, once the
  production is finished (they are null before that).
- Item origin is shown as "Pré-pesagem" (linking to the pre-weighing) or "Receita".

## Screens

All UI text in Portuguese. All routes live under `src/app/(app)/(production)/`, whose layout
already requires `PRODUCTION_READ`.

### Navigation

`nav-items.ts`: new item `{ to: "/productions", label: "Produções", icon: Factory, permission:
"PRODUCTION_READ" }`, right after "Pré-pesagens".

### `/productions` — list

- Newest first, cursor pagination with "Carregar mais" (same as the pre-weighings list).
- Status filter: Em andamento (default), Finalizadas, Canceladas, Todas. Kept in the URL as
  `?status=` (absent means "Em andamento"; `status=all` means no filter) and read by the server
  page. A query the schema refuses is read as no query at all.
- Columns: início, status (badge), produtos (item product names, summarized), itens (count).
  Expected/produced quantities are not summed in the list: items of one production may be in
  different units; they are shown per item in the detail.
- Each row links to the detail. "Nova produção" button only with `PRODUCTION_CREATE`.

### `/productions/new` — start

Requires `PRODUCTION_CREATE` and `CATALOG_READ` (layout, like `/pre-weighings/new`).

- **Pré-pesagens disponíveis**: checkbox list of pre-weighings with `available=true` (product,
  quantity, date), with "Carregar mais".
- **Itens sem pré-pesagem**: pick an active manufactured product and a quantity, "Adicionar".
  The screen asks for the recipe plan (same plan as the pre-weighing: inputs, planned quantity,
  shortfall). On success the item joins a table (removable) showing its inputs and a shortfall
  warning when there is one. On refusal (no recipe, inactive ingredient, quantity out of range)
  the item is not added and the message is shown. The server accepts the same product more than
  once, so the screen does too: each "Adicionar" is its own line.
- "Iniciar produção" is enabled with at least one item (guided or free). Success navigates to the
  detail. 404/409 (pre-weighing gone or already guiding another production, recipe changed) shows
  the message and refreshes the available pre-weighings.

### `/productions/[id]` — detail

- An address that is not an id, and an unknown id, both give `notFound()`.
- Header: status badge, started at, finished at / canceled at.
- Per item: product, origin, expected, produced, unit cost; below it, its inputs with quantity and
  unit cost.
- While in progress, with `PRODUCTION_CREATE`:
  - **Finalizar** (`FinishProductionForm`, inline on the page): one row per item with produced
    quantity (required, > 0, up to 6 decimals) and expiry date (optional, not in the past). On
    success the page refreshes and shows the costs.
  - **Cancelar** (`CancelProductionDialog`): confirmation dialog stating the pre-weighings become
    available again and the stock is not touched. On success the page refreshes.
- 409 on finish/cancel (already finished/canceled by someone else, cost out of range) shows the
  message and refreshes the page.

## Code structure

### Types and samples

- `src/lib/api.ts`: `Production`, `ProductionPage`, `StartProductionBody`, `FinishProductionBody`
  as `import type` of the zod schemas in `productions.schemas.ts`.
- `src/tests/samples.ts`: `aProduction()`, `aProductionPage()`.

### Server Actions — `src/features/productions/actions.ts`

Same shape as `features/pre-weighings/actions.ts`: `requireUser` → `can` → `safeParse` → service.

| Action | Permission | Service |
|---|---|---|
| `startProduction(body)` | `PRODUCTION_CREATE` | `productions.service.startProduction` |
| `finishProduction(id, body)` | `PRODUCTION_CREATE` | `productions.service.finishProduction` |
| `cancelProduction(id)` | `PRODUCTION_CREATE` | `productions.service.cancelProduction` |
| `loadMoreProductions(status, cursor)` | `PRODUCTION_READ` | `productions.service.listProductionsPage` |
| `planProductionItem(target)` | `PRODUCTION_READ` | `pre-weighings.service.previewPreWeighing` |
| `loadMoreAvailablePreWeighings(cursor)` | `PRODUCTION_READ` | `pre-weighings.service.listPreWeighingsPage` with `available: true` |

- start/finish/cancel call `revalidatePath` on `/productions` and the detail; start and cancel
  also on `/pre-weighings`, since they change which pre-weighings are available.
- The last two actions call the pre-weighing services directly, so `features/productions` does
  not import `features/pre-weighings`; the two features meet only at the service layer.

### Server pages — `src/app/(app)/(production)/productions/`

- `page.tsx`: parses `?status` and `?cursor`, calls `listProductionsPage`.
- `new/layout.tsx`: `RequirePermission` `PRODUCTION_CREATE` + `CATALOG_READ`.
- `new/page.tsx`: active manufactured products (`listProducts({ kind: ["MANUFACTURED"], status:
  "ACTIVE" })`) and the first page of available pre-weighings.
- `[id]/page.tsx`: parses the id, calls `getProduction`, `notFound()` on failure.

### Client components — `src/features/productions/`

- `ProductionsListPage.tsx`
- `StartProductionPage.tsx`
- `ProductionDetailPage.tsx`
- `FinishProductionForm.tsx`
- `CancelProductionDialog.tsx`

Formatting reuses `quantityOf`, `unitLabel`, `formatDate`, `toApiDecimal`, `positiveDecimal` and
`messageForFailure`; a status label map lives next to the list (used by list and detail).

## Errors

Portuguese messages per failure code (400/403/404/409) through `messageForFailure`, following the
existing forms. Unexpected errors fall through to the existing toast/error handling.

## Testing

TDD, red first, for every unit:

- RTL tests for the three page components, the finish form and the cancel dialog, with actions
  mocked through `vi.mock`.
- `AppShell.test.tsx`: "Produções" offered to whoever has `PRODUCTION_READ`.
- No new integration tests: the service and REST routes are already covered by
  `productions.routes.integration.test.ts`, and the actions are thin adapters with no rule.
- Server component pages have no RTL tests (project rule).

## Out of scope

- Any business rule change (partial yield, production losses, scheduled orders, who finished).
- REST routes and `openapi.json`.
- Linking a pre-weighing's detail page to the production it guides.
