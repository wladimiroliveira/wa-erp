# Stock units and packaging costs — design

Date: 2026-11-08
Branch: `feat/stock-units-and-packaging-costs`
Issue: #31 (part 3 of the enhancement milestone; builds on entries by packaging, PR #36)

## Goal

Make the stock screens easy to compare against invoices and the market: costs per kilogram or
litre whatever unit the product is kept in, the balance apart from its unit, and, for products
received in packagings, the price each packaging was bought at, last and over time.

The stock value error reported on #31 (380 g at 33,98 worth R$ 12.912,40) was a cost per kilogram
typed into a product kept in grams. Entries by packaging (PR #36) derive the cost per unit, and
showing costs per kilogram here makes such a mistake visible at a glance.

## Decisions

- **Costs are shown per kg or L.** A product kept in grams shows its costs per kilogram, one kept
  in millilitres per litre; kg, L and UN stay as they are. The API keeps answering in the
  product's unit; only the screen converts. Exact: costs carry 6 places, times 1000 loses nothing.
- **The balance stands apart from its unit.** Quantity columns show the number only; a column
  "Un." shows the unit. The balance stays in the product's unit (380 g does not become 0,38 kg).
- **The lot keeps the package price as typed** (2 places), so the last price of each packaging
  and its history read what the invoice said, never a recomputation that may miss a cent.
- **Packaging history lives on the product's stock page**; the stock list keeps one row per
  product, since a product may have several packagings or none.

## Part 1 — units on the stock screens

`src/shared/units.ts` (client and server):

```ts
/** A cost per unit of `unit` as a cost per kilogram or litre; kg, L and UN come back as they are. */
export function costPerReadableUnit(cost: string, unit: MeasurementUnit): { cost: string; unit: MeasurementUnit };
```

GRAM → KILOGRAM and MILLILITER → LITER multiply by 1000 on the decimal string (no float),
normalized as `normalizeDecimal` writes it.

`src/features/stock/stock-format.ts`:

- `unitCostOf(cost: string | null, unit: MeasurementUnit): string` — `"R$ 33,98/kg"`, `"—"` for null.
- `amountOf(quantity: string | null): string` — the number only, `"—"` for null.

Screens (all text in Portuguese):

- `StockPositionPage`: "Saldo" and "Mínimo" show `amountOf`; new column "Un." with the unit label
  after "Saldo"; "Último custo" and "Custo médio" show `unitCostOf`.
- `StockProductPage`: header "Saldo" keeps the unit ("380 g"); the lots table shows "Qtd. inicial"
  and "Saldo" with `amountOf`, a column "Un.", and "Custo unitário" with `unitCostOf`.
- `StockMovementsPage`: "Custo unitário" with `unitCostOf`.

## Part 2 — package price and packaging history

### Data

`StockLot` gains:

```prisma
packagePrice Decimal? @map("package_price") @db.Decimal(14, 2)
```

Migration (generated with `prisma migrate diff` from the previous schema, as before), then:

```sql
UPDATE "stock_lots" AS l
   SET "package_price" = round(l."unit_cost" * p."content", 2)
  FROM "product_packagings" AS p
 WHERE l."packaging_id" = p."id";

ALTER TABLE "stock_lots" ADD CONSTRAINT "ck_stock_lots_package_price_together"
  CHECK (("packaging_id" IS NULL) = ("package_price" IS NULL));
ALTER TABLE "stock_lots" ADD CONSTRAINT "ck_stock_lots_package_price_non_negative"
  CHECK ("package_price" IS NULL OR "package_price" >= 0);
```

### Entries

- `entries.service.ts`: a packaged entry passes `packagePrice` with the packaging and count.
- `stock.repository.ts` `openLot`: optional `packagePrice`, written with the packaging; the
  selected lot includes it.
- `entrySchema.lot.packaging` becomes `{ id, content, count, price }`.

### `GET /v1/stock/{sku}`

- Each lot gains `packaging: { id, content, count, price } | null`.
- The response gains `packagings`, one row per packaging of the product that is active or has
  lots, in order of content:

```ts
{
  id: string; content: string; isActive: boolean;
  lastEntry: { price: string; createdAt: string; supplier: { id, name } | null } | null;
  history: Array<{ lotId: string; createdAt: string; supplier: { id, name } | null; count: number; price: string }>;
}
```

  `history` lists every lot of that packaging, depleted ones included whatever `depleted` says,
  newest first; `lastEntry` is its first row (null when empty).
- `stock.repository.ts` `findProductWithStock` also selects the packagings with their lots
  (`id, createdAt, packageCount, packagePrice, supplier`), newest first.
- `stock.service.ts` builds `packagings` in a pure function `packagingCostsOf` next to
  `stock.position.ts`.
- `openapi.json` regenerated.

### `StockProductPage`

- New section **"Embalagens"** above the lots, shown when `packagings` is not empty. One row per
  packaging: Embalagem ("380 g"), Último preço ("R$ 12,91"), Equivale a ("R$ 33,97/kg", from the
  price ÷ content through `packageUnitCost` and `unitCostOf`), Última entrada (date), Fornecedor.
  An inactive packaging carries the badge "Inativa"; one without entries shows "Sem entradas" in
  the price cells. A button "Histórico" opens a dialog listing its entries: Data, Fornecedor,
  Quantidade, Preço.
- Lots table: new columns "Embalagem" ("10 × 380 g", "—" for a loose lot) and "Preço emb."
  ("R$ 12,91", "—").

## Tests (TDD: each one red first)

`src/shared/units.test.ts`
1. `costPerReadableUnit("0.03398", "GRAM")` is `{ cost: "33.98", unit: "KILOGRAM" }`;
   `("0.0045", "MILLILITER")` is `{ cost: "4.5", unit: "LITER" }`; kg, L and UN unchanged.

`stock-format.test.ts`
2. `unitCostOf("0.03398", "GRAM")` is `"R$ 33,98/kg"`; null is `"—"`; `amountOf("380")` is `"380"`.

`StockPositionPage.test.tsx`
3. "Saldo" shows the number, "Un." the unit; "Custo médio" of a gram product shows R$/kg.

`StockProductPage.test.tsx`
4. Lots show "Un.", cost per kg, "Embalagem" ("10 × 380 g") and "Preço emb.".
5. "Embalagens" lists last price, equivalent per kg, date and supplier; "Inativa" and
   "Sem entradas" appear; "Histórico" opens the entries newest first.

`StockMovementsPage.test.tsx`
6. "Custo unitário" of a gram product shows R$/kg.

`stock` service (pure)
7. `packagingCostsOf`: newest first, `lastEntry` is the newest, empty history gives null,
   inactive packaging without lots left out.

`entries.service.test.ts`
8. A packaged entry passes `packagePrice` to the lot.

Integration (Postgres; CI only)
9. A packaged entry stores `package_price`; the check constraints refuse a price without
   packaging, a packaging without price and a negative price.
10. `GET /v1/stock/{sku}` returns `packagings` with history including depleted lots.

`prisma/tests/stock-schema.test.ts`
11. `StockLot` has `packagePrice` as `Decimal(14, 2)`.

## Out of scope

Price trend charts; comparison between suppliers; paging the history; editing a lot's cost or
fixing the staging lot entered per gram; costs per kg on the pricing and production screens.
