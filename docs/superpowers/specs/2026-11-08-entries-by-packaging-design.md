# Entries by packaging — design

Date: 2026-11-08
Branch: `feat/entries-by-packaging`
Issue: #28 (part 2 of the enhancement milestone; builds on product packagings, PR #35)

## Goal

Receive goods the way the invoice lists them: "10 bags of 380 g at R$ 4.50", or by reading the
bag's barcode, instead of working out kilograms and cost per kilogram by hand. Stock, average cost
and lots stay in the product's own unit; the lot also remembers which packaging and how many
came in, for the waste calculation of #29.

## Decisions

- **Two shapes of entry.** By packaging (`packagingId`, `packageCount`, `packagePrice`) or in the
  product's unit (`quantity`, `unitCost`, unchanged). A product with packagings may still be
  received in its own unit ("Sem embalagem"): returns, leftovers, a supplier delivering loose.
- **Package count is a whole number** (≥ 1): an invoice never lists half a bag.
- **Package price has at most 2 decimals** (money as typed and shown). The cost per unit of the
  product derived from it keeps 6 decimals internally, so 10 bags at R$ 4.50 sum to R$ 45.00.
  Every amount of money on screen is shown with 2 decimals.
- **The loose unit cost keeps 6 decimals**, as today: a cost per kilogram on an invoice may carry
  more than 2.
- **The lot keeps the packaging and the count.** `quantity` and `unit_cost` stay in the product's
  unit, so stock, average cost, allocation and pricing do not change.
- **A packaging with lots cannot be deleted.** Saving a product whose list leaves out such a
  packaging is refused (409); it can still be inactivated. This closes the rule left open in
  part 1.
- **Barcode reading on the entry screen** looks the GTIN up among the active packagings of the
  active products the page already loads; no new endpoint.

## Data

`StockLot` gains:

```prisma
packagingId  String?           @map("packaging_id") @db.Uuid
packaging    ProductPackaging? @relation(fields: [packagingId], references: [id], onDelete: Restrict)
packageCount Int?              @map("package_count")

@@index([packagingId], map: "idx_stock_lots_packaging_id")
```

`ProductPackaging` gains `lots StockLot[]`.

Migration (generated with `prisma migrate diff` from the previous schema, as in part 1), plus:

```sql
ALTER TABLE "stock_lots" ADD CONSTRAINT "ck_stock_lots_packaging_count_together"
  CHECK (("packaging_id" IS NULL) = ("package_count" IS NULL));
ALTER TABLE "stock_lots" ADD CONSTRAINT "ck_stock_lots_package_count_positive"
  CHECK ("package_count" IS NULL OR "package_count" > 0);
```

## Shared code

- `src/shared/decimal.ts`: `moneySchema` (`/^\d{1,12}(\.\d{1,2})?$/`).
- `src/shared/packaging-entry.ts` (new, pure, client and server):
  - `packagedQuantity(content: string, count: number): string` — exact product, normalized.
  - `costPerUnit(packagePrice: string, content: string): string` — price ÷ content, 6 decimals,
    rounded half up, scaled `BigInt` as in `src/shared/pricing.ts`.
  Both are used by the service and by the live line under the form.

## Server — `src/server/modules/entries/`

- `entries.schemas.ts`:
  - `createEntryBodySchema` becomes the union of
    `loose = { productSku, quantity: positiveDecimal, unitCost: decimal, expiresAt, supplierId?, deficit? }` and
    `packaged = { productSku, packagingId: uuid, packageCount: int ≥ 1, packagePrice: moneySchema, expiresAt, supplierId?, deficit? }`,
    each `.strict()` so a body mixing both shapes is refused (400).
  - `entrySchema.lot` gains `packaging: { id, content, count } | null`.
- `entries.service.ts` `recordEntry`:
  - For a packaged body: the packaging must belong to the product (else 404 "Packaging not
    found."), be active (else 409 "Packaging is inactive."); quantity = `packagedQuantity`, which
    must fit `decimalSchema` (else 400); unit cost = `costPerUnit`. Then the existing flow, with
    the packaging and count passed to the lot.
  - A loose body behaves exactly as today.
- `entries.repository.ts`: `findProductBySku` also selects the product's packagings
  (`id, content, isActive`); `insertEntry` passes `packagingId` and `packageCount` to `openLot`.
- `stock.repository.ts` `openLot`: optional `packagingId` and `packageCount`, written to the lot;
  the selected lot includes `packagingId`, `packageCount` and the packaging's `content`.

## Server — products (closing part 1)

- `products.repository.ts`: `findPackagingsWithLots(productSku)` returns the ids of the product's
  packagings that some lot refers to; the product response does not change.
- `products.service.ts` `editProduct`: a stored packaging with lots that is missing from the list
  → 409 `PRODUCT_CONFLICTS.inUse` ("A packaging with stock lots cannot be removed.").
- `ProductDialog.tsx`: that 409 shows "Essa embalagem já recebeu entradas e não pode ser removida;
  inative-a." (Today stored rows already offer only Inativar, so this is reachable only through
  the API or a stale screen.)

## REST

`POST /v1/entries` body and response as above; `openapi.json` regenerated.

## Web — `src/features/entries/EntryPage.tsx`

All UI text in Portuguese. Fields, top to bottom:

1. **Código de barras** (optional, autofocus). On Enter (sent by scanners) or blur, the GTIN is
   looked up among active packagings of active products. Found: Produto and Embalagem are filled
   and focus moves to Quantidade. Not found: "Código não cadastrado em nenhuma embalagem ativa.",
   nothing else changes. Enter in this field never submits the form.
2. **Produto** — as today.
3. **Embalagem** — shown only when the product has active packagings. Options: each active
   packaging in its readable unit ("380 g", "1 kg"), then "Sem embalagem (kg)" (the product's
   unit label). Defaults to the first packaging.
4. With a packaging: **Quantidade** (whole number of packagings) and **Preço por embalagem** (R$, 2 decimals),
   with a live line below: "= 3,8 kg a R$ 11,84/kg". Without: **Quantidade** and **Custo
   unitário**, as today.
5. **Validade** and **Fornecedor** — as today.

After recording, the summary reads "10 × 380 g (3,8 kg)" for a packaged entry; the form resets
and focus returns to Código de barras. The negative-balance dialog keeps working for both shapes
(it resends the same body with `deficit`).

## Tests (TDD: each one red first)

`src/shared/packaging-entry.test.ts`
1. `costPerUnit("4.50", "0.38")` is `"11.842105"`; `costPerUnit("10.00", "2")` is `"5.000000"`;
   half-up rounding: `costPerUnit("0.01", "20000")` (exactly 0.0000005) is `"0.000001"`, and
   `costPerUnit("0.01", "30000")` (0.00000033…) is `"0.000000"`.
2. `packagedQuantity("0.38", 10)` is `"3.8"`.

`entries.schemas` / `entries.service.test.ts` (repository mocked)
3. A packaged body records quantity 3.8 and unit cost 11.842105, passing packaging and count.
4. Packaging of another product → 404; inactive packaging → 409; quantity that does not fit → 400.
5. A body mixing `quantity` and `packagingId` is refused by the schema; `packagePrice` with 3
   decimals and `packageCount` 1.5 or 0 are refused.
6. A loose body is recorded exactly as before.

`products.service.test.ts`
7. Removing a stored packaging with lots → 409 `PRODUCT_CONFLICTS.inUse`; removing one without
   lots still works.

`EntryPage.test.tsx` (jsdom, action via `vi.mock`)
8. Reading a known GTIN fills product and packaging; an unknown one shows the message.
9. The packaging select lists active packagings and "Sem embalagem (kg)"; inactive ones are absent.
10. The live line shows "= 3,8 kg a R$ 11,84/kg" for 10 × 380 g at 4,50.
11. The packaged body and the loose body are sent as specified; Enter in the barcode field does
    not submit.
12. After recording, the summary shows "10 × 380 g (3,8 kg)" and focus returns to the barcode.

Integration (Postgres; CI only)
13. A packaged entry stores the lot with `packaging_id`, `package_count`, quantity and cost.
14. The check constraints refuse a lot with only one of the two columns.
15. PATCH of a product leaving out a packaging with lots → 409, nothing written.

`prisma/tests/catalog-schema.test.ts` or the stock schema test
16. `StockLot` has `packagingId` / `packageCount` and the index; conventions still hold.

## Out of scope

Pre-weighing and waste (#29); stock value and columns (#31); several items per entry; scale
labels (variable-weight barcodes); the deferred minors of part 1.
