# Packaging brand — design

Date: 2026-11-09
Branch: `feat/packaging-brand`

## Goal

Let a recipe use any brand of an ingredient. Today, once a manufactured product's recipe names a
"condensed milk, brand X" product, condensed milk of brand Y cannot be used for it, although both
are the same commodity. The product becomes the commodity ("LEITE CONDENSADO", in kg) and the
brand moves down to the packaging it is bought in ("MOÇA 395 g", "ITALAC 395 g"). Recipes,
stock balance, average cost, pre-weighing and production stay at the product level and so take
whichever brand is in stock, in the order lots are used today (first to expire first).

## Decisions

- **Product = commodity, packaging = brand + content.** No new entity above the product. Every
  `GOODS` product is only consumed, never resold, so a brand never needs its own SKU, markup or
  unit.
- **Grouping is a business decision.** Whether two items are interchangeable (condensed milk vs
  "mistura láctea", 17 % vs 25 % cream) is up to whoever registers the products; the system
  enforces nothing about it.
- **Brand is free text, required, on the packaging.** No `Brand` table and no brand screen.
- **Brand is normalized like the product description**: trimmed, NFC, upper case in pt-BR, 1 to
  60 characters. One normalizer serves both fields.
- **A product holds one packaging per brand and content.** The unique index moves from
  `[productSku, content]` to `[productSku, brand, content]`. The GTIN stays globally unique.
- **Brand can be edited at any time**, lots or no lots, so that a typo can be fixed. The lots that
  came in that packaging show the new spelling. Content stays locked once the packaging has lots,
  as it is today.
- **No data to migrate.** There is no real data yet; packagings that exist in test databases get
  the placeholder brand `SEM MARCA` so that the column can be NOT NULL.
- **Brand is shown in the product register, the goods entry and the stock screens.** Production
  and pre-weighing screens do not show it (out of scope).
- **No REST compatibility constraint.** The Flutter client does not exist yet; `/v1` changes and
  `openapi.json` is regenerated.

## Data

```prisma
model ProductPackaging {
  // ...
  brand String
  // ...
  @@unique([productSku, brand, content], map: "uq_product_packagings_product_sku_brand_content")
}
```

Migration `add_product_packaging_brand`:

1. Add `brand TEXT NOT NULL DEFAULT 'SEM MARCA'`, then drop the default.
2. Drop `uq_product_packagings_product_sku_content`.
3. Create `uq_product_packagings_product_sku_brand_content`.

## Server

### `products` module

- `products.schemas.ts`
  - Extract the description normalization into a reusable schema builder (trim, NFC, pt-BR upper
    case, bounded length); `descriptionSchema` (max 120) and the new `brandSchema` (max 60) both
    use it.
  - `packagingSchema` (response) gains `brand: string`.
  - `createPackagingSchema` and `updatePackagingSchema` gain `brand: brandSchema` (required).
  - The 409 message for a repeated packaging becomes "The product already has a packaging of this
    brand with this content." (key `content` in the refusals is renamed to tell what it is about).
  - Response packagings are ordered by brand, then content.
- `products.service.ts`
  - Writes carry the brand.
  - A list that names the same brand and content twice is refused 409, before writing.
  - The content lock on packagings with lots is unchanged; the brand is not locked.
  - The unique violation on the new index maps to the same 409.
- `packaging-sync.ts`
  - `planPackagingSync` orders updates by the `(brand, content)` pair a write takes and another
    still holds, not by content alone. A cycle (two packagings swapping pairs) is still left to
    the index to refuse.
- `products.repository.ts` reads and writes `brand`.

### Responses carrying a lot's packaging

- `entries`: the lot's `packaging` gains `brand`.
- `stock`: the lots of a product gain `packaging.brand`; `packagingCostsOf` returns `brand` for
  each packaging and sorts by brand, then content.

Production and pre-weighing contracts do not change: their leftover and waste computations
already use the packaging of each lot taken, so mixed brands of different contents are handled.

## Client

- `src/features/stock/stock-format.ts`: new `packagingLabel(brand, content, unit)` → `"MOÇA 395 g"`.
  Every screen below uses it instead of composing the text.
- `PackagingFields`: each row gains a required "Marca" input, upper-cased as typed; the form refuses
  the same brand and content twice ("Cada marca só pode ter uma embalagem com esse conteúdo.").
  `rowOf`, `toCreatedPackaging` and `toEditedPackaging` carry the brand.
- `ProductDialog`: shows the server's 409 for a repeated brand and content on the packagings.
- `ProductsListPage`: packaging summary reads `"MOÇA 395 g · ITALAC 1 kg"`.
- `EntryPage`: the packaging select shows the label; the posted lot reads
  `"12 × MOÇA 395 g (4,74 kg)"`. Barcode lookup is unchanged.
- `StockProductPage`: lots show the brand.
- `PackagingCostsSection`: each row and the history dialog title use the label, so prices are
  told apart by brand.
- `src/tests/samples.ts`: packaging samples gain a brand.

## Testing (TDD: each test fails first)

- `products.schemas.test.ts`: brand required, trimmed, upper-cased, NFC, length bounds.
- `products.service.test.ts`: same content with two brands accepted; same brand and content twice
  refused 409; brand edited on a packaging with lots accepted; content change on a packaging with
  lots still refused.
- `packaging-sync.test.ts`: a chain at the same content (MOÇA → ITALAC while ITALAC → PIRACANJUBA)
  is ordered so that no write takes a pair another still holds; same content under different brands
  never blocks one another.
- `stock.packaging-costs.test.ts`: brand returned, order by brand then content.
- `stock-format` test for `packagingLabel`.
- RTL: `ProductDialog` (brand field, required, duplicate refused), `ProductsListPage`, `EntryPage`
  and `StockProductPage` show the label.
- Integration (`products`, `entries`, `stock` routes): brand round-trips through the API, run with
  `npm run test:integration` against the Docker Postgres (`TEST_DATABASE_URL`).

## Out of scope

- Brand on production and pre-weighing inputs.
- A registered `Brand` entity, brand filters or reports.
- A tool to merge products registered per brand.
