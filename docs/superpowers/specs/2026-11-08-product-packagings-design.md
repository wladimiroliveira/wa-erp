# Product packagings — design

Date: 2026-11-08
Branch: `feat/product-packagings`
Issue: #27 (part 1 of the enhancement milestone; #28, #29 and #31 build on it)

## Goal

Let a product be registered with the packagings it is bought in (a 1 kg bag and a 5 kg bag of
the same sugar), each with its content and its own GTIN, and keep product descriptions in upper
case. Stock, recipes and costs stay in the product's own unit: a packaging is a convenience on
top of that unit, not a new unit.

## Decisions

- **One product, many packagings.** The same item in different sizes is one product with one
  stock balance, one average cost and one place in recipes. A packaging has no name: it is told
  apart by its content ("1 kg", "5 kg").
- **Content in the product's unit.** Stored as a decimal in the product's `MeasurementUnit`.
  It may be typed in any unit of the same dimension: a `KILOGRAM` product takes `GRAM` or
  `KILOGRAM`, a `LITER` product takes `MILLILITER` or `LITER`, a `UNIT` product takes only `UNIT`.
  A unit of another dimension is refused.
- **GTIN belongs to the packaging only.** `products.gtin` is dropped without migrating its
  values (only a staging database exists; the user accepted losing them). A loose product
  (granel) has no packaging and therefore no GTIN.
- **GTIN check digit is validated on the server** as well as on the client.
- **Upper case description.** The server upper-cases the description before any check or write,
  so every client is covered; the input upper-cases as the operator types.
- **Packagings are saved with the product**, in one transaction, through the existing product
  endpoints and actions. There are no packaging endpoints; they may be added later if needed.
- **Inactivate, do not delete, a packaging in use.** An inactive packaging is no longer offered
  for new entries (#28). Deleting is allowed only while no lot refers to it; in this part no lot
  can, since lots gain that link in #28.
- **No REST compatibility constraint.** The Flutter client does not exist yet, so `/v1` changes
  freely; `openapi.json` is regenerated.

## Data

New Prisma model and migration:

```prisma
model ProductPackaging {
  id         String   @id @default(uuid(7)) @db.Uuid
  productSku String   @map("product_sku") @db.Uuid
  product    Product  @relation(fields: [productSku], references: [sku], onDelete: Restrict)
  content    Decimal  @db.Decimal(18, 6)
  gtin       String?  @unique
  isActive   Boolean  @default(true) @map("is_active")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@unique([productSku, content], map: "uq_product_packagings_product_sku_content")
  @@map("product_packagings")
}
```

`Product` gains `packagings ProductPackaging[]` and loses `gtin`.

Migration, in this order:

1. Create `product_packagings` (with `CHECK (content > 0)`).
2. Drop `products.gtin` and its unique index.
3. `UPDATE products SET description = upper(description)`. If two descriptions become equal the
   unique index makes the migration fail, naming the value; nothing is renamed automatically.
   `upper()` follows the database collation and leaves accented letters alone under `C`, so the
   statement uses `upper(description COLLATE "und-x-icu")`, which upper-cases them whatever the
   database collation, matching JavaScript's `toUpperCase()`.

## Shared code

- `src/shared/units.ts` (new, pure, client and server):
  - `dimensionOf(unit)` → `"MASS" | "VOLUME" | "COUNT"`.
  - `compatibleUnits(unit)` → the units of the same dimension, in display order.
  - `convert(quantity, from, to)` → decimal string, exact: units of one dimension differ by
    powers of 1000, so converting only moves the decimal point. Throws on units of different
    dimensions. It never rounds; the caller checks the result against `decimalSchema` (at most
    12 integer and 6 decimal digits) and refuses one that does not fit.
  - `readableQuantity(quantity, unit)` → `{ quantity, unit }`: a mass or volume of at least
    1 kg or 1 L is shown in kg or L, anything smaller in g or mL, whatever the product's unit
    (0.38 kg → 380 g; 1010 g → 1.01 kg). `UNIT` is returned as is.
  This module is also what #29 will use to switch the planned column between g and kg.
- `src/shared/gtin.ts`: `hasValidCheckDigit` moves here from `src/lib/gtin.ts` so the server
  schema uses the same rule. The client imports it from the new place.

## Server — `src/server/modules/products/`

- `products.schemas.ts`:
  - `packagingSchema` (response): `{ id, content, gtin: string | null, isActive }`.
  - `productSchema`: drops `gtin`, adds `packagings: packagingSchema[]` ordered by content.
  - `gtin`: 8 to 14 digits **and** a valid check digit.
  - `description`: trimmed, 1–120 chars, transformed to upper case.
  - `createProductBodySchema.packagings?`: `[{ content: positiveDecimal, unit, gtin? }]`.
  - `updateProductBodySchema.packagings?`: the full desired list,
    `[{ id?, content: positiveDecimal, unit, gtin: string | null optional, isActive? }]`.
    Absent means the packagings are left as they are.
  - Within one list, no two packagings may share a GTIN (400).
- `products.service.ts`:
  - Converts each packaging content from its typed unit to the product's unit with
    `convert`; an incompatible unit or a result that does not fit 6 decimals → 400.
  - Two packagings of the same product with the same converted content → 409.
  - A GTIN already used by a packaging of any other product → 409.
  - Description conflicts are checked on the upper-cased value → 409.
  - Update syncs the list: an item with `id` updates that packaging (404 if the id is not one of
    this product's), an item without `id` creates one, a stored packaging missing from the list
    is deleted; if a lot refers to it the whole request is refused (409) and nothing is written.
- `products.repository.ts`: selects packagings with the product; inserts and syncs them inside
  the existing product transaction; the `q` search matches the description or the GTIN of any
  of the product's packagings.

Each 409 carries its own message so the client can tell them apart.

## REST

- `GET /v1/products`, `POST /v1/products`, `PATCH /v1/products/{sku}`: bodies and responses as
  above; summaries updated to mention packagings.
- `npm run openapi:dump` is rerun and `openapi.json` committed.

## Web

All UI text in Portuguese.

- `ProductDialog.tsx`:
  - Description input upper-cases the value as it is typed.
  - The GTIN field is replaced by an "Embalagens" section, below the unit. One row per
    packaging: content (`NumericInput`), unit (`NativeSelect` with `compatibleUnits` of the
    product's unit), GTIN (optional, same check-digit validation as today), and "Remover" for a
    new row or "Inativar"/"Reativar" for a stored one. "Adicionar embalagem" appends a row.
  - For a new product the section is enabled only once the unit is chosen.
  - A stored packaging is shown with `readableQuantity` (0.38 kg → 380 g).
  - The 409s are shown in the dialog's alert with a message per case (description, GTIN or
    content already in use).
- `ProductsListPage.tsx`: the "GTIN" column becomes "Embalagens", listing the active
  packagings with `readableQuantity` ("380 g · 1 kg"). The search placeholder stays
  "Buscar por descrição ou GTIN".
- `src/features/products/actions.ts`: unchanged in shape; passes the new bodies through.
- `src/tests/samples.ts`: product factory drops `gtin`, gains `packagings: []`.

## Tests (TDD: each one red first)

`src/shared/units.test.ts`
1. `convert` g → kg and kg → g, mL → L and L → mL, exactly (380 g → 0.38 kg; 1.01 kg → 1010 g).
2. `convert` refuses units of different dimensions.
3. `convert` keeps every digit (0.0005 g → 0.0000005 kg) instead of rounding.
4. `compatibleUnits` per unit; `UNIT` only with itself.
5. `readableQuantity` moves 0.38 kg to 380 g and keeps 1.5 kg as kg.

`src/shared/gtin.test.ts` (moved from `src/lib/gtin.test.ts`, unchanged).

`products.service.test.ts` (new, repository mocked)
6. Description is upper-cased before the conflict check and the write.
7. Packaging content is converted to the product's unit.
8. Incompatible unit → 400; two equal contents → 409; GTIN of another product → 409.
9. Update sync: updates by id, creates without id, deletes what is missing, 404 for a foreign id.

`products.schemas` (in the service test or its own file)
10. A GTIN with a wrong check digit is refused; a repeated GTIN within one list is refused.

`products.routes.integration.test.ts` (Postgres; does not run in the local WSL — CI only)
11. Existing GTIN cases rewritten for packagings; create, update sync and search by packaging
    GTIN against the database.

`prisma/tests/catalog-schema.test.ts`
12. Updated for the dropped column and the new table.

`ProductDialog.test.tsx` (jsdom, actions via `vi.mock`)
13. The description is upper-cased as typed.
14. Adding and removing packaging rows; the unit select offers only compatible units.
15. The body sent to the action carries content, unit and GTIN per row.
16. A stored packaging shows in its readable unit and toggles active/inactive.
17. Each 409 shows its own message.

`ProductsListPage.test.tsx`
18. The "Embalagens" column lists the active packagings in readable units.

## Out of scope

- Entries by packaging and the lot → packaging link (#28).
- Stock value and balance/unit columns (#31).
- Pre-weighing unit choice, 3 decimals and waste optimization (#29).
- Packaging endpoints of their own.
- Composite packagings (a box made of 12 bags of 380 g). A `UNIT` product's "box of 12" is
  already a plain packaging of content 12; a box of bags of a mass product is registered by its
  total content (4.56 kg) until #29 shows whether waste optimization needs the structure.
- The other findings of the catalog sweep, except the server-side GTIN check digit and the
  upper-case description, which come with this change.
