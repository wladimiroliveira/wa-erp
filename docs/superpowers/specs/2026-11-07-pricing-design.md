# Pricing — design

Date: 2026-11-07
Branch: `feat/pricing`

## Goal

Answer, for every manufactured product, "what does one unit cost and what should it sell for?".
Cost comes from the recipe and the current stock average cost of each ingredient; price is that
cost plus a markup kept per product. Web only: no REST route, no Flutter client in this work.

## Decisions

- **Scope:** only `MANUFACTURED` products that are active and have a recipe. Resale products
  (`GOODS`) and a stored/approved sale price with history are out of scope.
- **Ingredient cost:** `ProductStock.averageCost`. An ingredient that is itself `MANUFACTURED`
  is costed the same way (its average cost from finished productions); there is no cascade
  through its recipe.
- **Price formula:** markup over cost, nothing else (no labor, no overhead).

  ```
  ingredients  = Σ (ingredient quantity × ingredient averageCost)
  costPerUnit  = ingredients ÷ recipe.yieldQuantity
  pricePerUnit = costPerUnit × (1 + markupPercent / 100), rounded UP to the cent
  ```

- **Unit:** the price is per unit of the product's own `MeasurementUnit` (R$/un, R$/kg, ...).
- **Missing cost:** if any ingredient has no `averageCost`, the product is "custo incompleto":
  no cost and no price are shown, and the missing ingredients are listed. There is never a
  partial cost and a missing cost is never read as zero.
- **Markup storage:** its own table, keyed by product, owned by the `pricing` module. `recipes`
  and `products` (schemas, services, REST contract) do not change.
- **Markup unit:** stored as a percentage (`35.00` means 35 %), so there is no ×100 conversion
  at any boundary. Accepted range: 0 to 1000, at most 2 decimal places.
- **Permissions:** two new values, `PRICING_READ` (see the pricing screen) and `PRICING_UPDATE`
  (edit the markup). The `Permission` enum is part of `openapi.json`, so it is regenerated; the
  Flutter client must be regenerated before any role is given these permissions.
- **One calculation:** a single pure function module computes cost and price, used both by the
  service and by the live preview in the browser. It works in fixed point with `BigInt`, since
  the client has no decimal library and `number` would miss cents.

## Data

New Prisma model and migration:

```prisma
model ProductMarkup {
  productSku    String   @id @map("product_sku") @db.Uuid
  product       Product  @relation(fields: [productSku], references: [sku], onDelete: Restrict)
  markupPercent Decimal  @map("markup_percent") @db.Decimal(7, 2)
  updatedById   String   @map("updated_by_id") @db.Uuid
  updatedBy     User     @relation(fields: [updatedById], references: [id], onDelete: Restrict)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("product_markups")
}
```

`Permission` gains `PRICING_READ` and `PRICING_UPDATE` (Prisma enum, `src/shared/enums.ts`,
`src/lib/permissions.ts` with labels "Ver precificação" / "Editar markup" and a group
"Precificação"). `npm run openapi:dump` is rerun and the new `openapi.json` committed.

## Calculation — `src/shared/pricing.ts`

Pure, no Prisma, importable by client and server. Inputs and outputs are decimal strings.

- `costPerUnit({ yieldQuantity, ingredients: [{ productSku, quantity, averageCost | null }] })`
  → `{ status: "complete", costPerUnit }` or `{ status: "incomplete", missing: productSku[] }`.
  The cost keeps 6 decimal places (same scale as the database).
- `priceFor(costPerUnit, markupPercent)` → price string with 2 decimal places, rounded up.

## Server — `src/server/modules/pricing/`

- `pricing.schemas.ts`: zod `markupPercentSchema` (decimal string, 0–1000, ≤ 2 places) and
  `setMarkupSchema` (`{ productSku, markupPercent }`); the `PricingRow` type. No `@prisma/client`.
- `pricing.repository.ts`:
  - `listPricingSources()`: one query returning active `MANUFACTURED` products that have a
    recipe, with yield, ingredients (sku, description, unit, quantity, averageCost) and the
    markup if any. No N+1.
  - `upsertMarkup({ productSku, markupPercent, updatedById })`.
  - `findProductKind(sku)` for the `setMarkup` checks.
- `pricing.service.ts`:
  - `listPricing()` → `PricingRow[]`, each with `status`: `priced` (complete cost and a markup),
    `no-markup` (complete cost, no markup: price is null) or `incomplete-cost` (cost and price
    null, missing ingredients listed). Each row carries the per-ingredient detail (quantity,
    average cost, subtotal) for the detail sheet. Sorted by product description.
  - `setMarkup(user, input)`: 404 if the product does not exist, 409 if it is not
    `MANUFACTURED`; records `updatedById`.

No route under `src/app/v1`.

## Web

All UI text in Portuguese.

- `src/app/(app)/(pricing)/layout.tsx`: `RequirePermission permission="PRICING_READ"`.
- `src/app/(app)/(pricing)/pricing/page.tsx`: Server Component, calls `listPricing()`.
- `nav-items.ts`: `{ to: "/pricing", label: "Precificação", icon: Calculator, permission:
  "PRICING_READ" }`, right after "Produções".
- `src/features/pricing/PricingPage.tsx`: table with Produto, Unidade, Rendimento, Custo/un,
  Markup (%), Preço/un and a status badge ("Sem markup", "Custo incompleto"); "—" where a value
  is null. Search by product name, same filter pattern as the other lists.
  - With `PRICING_UPDATE`, the markup cell is an input: typing recalculates the price live with
    `priceFor`; Enter or the save button calls the action; Esc restores the saved value. On
    error, a toast and the previous value come back. Without `PRICING_UPDATE`, plain text.
  - Clicking a row opens a `Sheet` (same pattern as `RecipeSheet`) with each ingredient's
    quantity, average cost and subtotal; ingredients without average cost are highlighted.
- `src/features/pricing/actions.ts`: `saveMarkup` → `requireUser` with `PRICING_UPDATE`
  → `setMarkup` → `revalidatePath("/pricing")`.

## Tests (TDD: each one red first)

`src/shared/pricing.test.ts`
1. `costPerUnit` sums quantity × average cost and divides by the yield.
2. One ingredient without average cost gives `incomplete` with its sku, never a partial cost.
3. `priceFor` rounds up to the cent (1.231 → 1.24) and leaves an exact value alone (1.23 → 1.23).
4. Markup 0 returns the cost rounded up to the cent.
5. Values that fail in floating point (0.1 + 0.2) come out exact.

`pricing.service.test.ts` (repository mocked)
6. The three statuses come out right.
7. A `MANUFACTURED` ingredient is costed by its stock average cost.
8. `setMarkup` refuses an unknown product (404) and a `GOODS` product (409).

`pricing.repository.integration.test.ts` (Postgres; does not run in the local WSL)
9. `listPricingSources` returns only active `MANUFACTURED` products with a recipe, with costs.
10. `upsertMarkup` creates then updates, recording `updated_by_id`.

`PricingPage.test.tsx` (jsdom, action via `vi.mock`)
11. Shows cost, markup and price formatted as R$ and %.
12. Shows the badge and "—" for `no-markup` and `incomplete-cost`.
13. Editing the markup recalculates the price before saving.
14. Enter calls `updateMarkupAction` with sku and percent; Esc restores the value.
15. Without `PRICING_UPDATE` there is no input.
16. An action error shows a toast and restores the previous value.
17. Clicking a row opens the detail with the ingredients, highlighting those without cost.

Action
18. `updateMarkupAction` without `PRICING_UPDATE` is refused, same pattern as the other actions.

## Out of scope

Resale products (`GOODS`); a stored sale price and its history; labor and overhead; cascade
costing through sub-recipes; REST `/v1/pricing` and the Flutter screen; bulk markup editing.
