# Opened packaging leftovers — design

Date: 2026-11-09
Branch: `feat/opened-leftovers`
Issue: #29 (part 4c of the enhancement milestone; builds on #36 lot packagings and #40
`isStorableOnceOpened`)

## Goal

When a production consumes an ingredient that cannot be kept once opened (condensed milk, cream),
what is left of the opened packaging goes to the bin, but today it stays in the stock balance and
value. Write that leftover off automatically when the production finishes, as a movement of its
own tied to the production, and let whoever finishes it decide whether its cost goes into the cost
of what was produced.

## Decisions

- **A movement type of its own**, `OPENED_LEFTOVER` ("Sobra de embalagem aberta"), not a loss with
  a reason: leftovers are part of the process, need no reason and stay traceable to the production.
- **Decided at finish**: the finish screen shows the leftovers to be discarded and a checkbox
  "Incluir as sobras no custo da produção", **checked by default**. The choice is stored on the
  production and never changed afterwards (changing it would rewrite average costs already used).
- **Leftover of a lot** = what the lot holds after the consumption that is not a whole packaging:
  `(quantity − taken) mod content`. The lot keeps only closed packagings, which also clears an old
  opened packaging left from before this feature.
- **The items of a production share the packagings they open** (they are made together): every
  item takes its inputs first, then each lot's leftover is worked out once, on what all the inputs
  took from it, and split among those inputs by what each took (`splitLeftover`, 6 places, the
  last share taking what rounding left). Each share's cost goes to its item. Two items of 100 g
  from one lot of 395 g cans open one can and discard 195 g, not two cans and 590 g.
- Only lots that came in a packaging, of products with `isStorableOnceOpened = false`, that the
  consumption took from. Loose lots, storable products and the part taken beyond the lots (owed)
  make no leftover.

## Data

```prisma
enum StockMovementType { … OPENED_LEFTOVER }

model Production {
  …
  // Whether the cost of the leftovers discarded at finish went into the cost produced; null until it finishes.
  hasLeftoversInCost Boolean? @map("has_leftovers_in_cost")
}

// What was discarded of an opened packaging of a lot when an input of a production consumed it.
model ProductionLeftover {
  id         String              @id @default(uuid(7)) @db.Uuid
  inputId    String              @map("input_id") @db.Uuid
  input      ProductionItemInput @relation(fields: [inputId], references: [id], onDelete: Restrict)
  lotId      String              @map("lot_id") @db.Uuid
  lot        StockLot            @relation(fields: [lotId], references: [id], onDelete: Restrict)
  movementId String              @unique @map("movement_id") @db.Uuid
  movement   StockMovement       @relation(fields: [movementId], references: [id], onDelete: Restrict)
  quantity   Decimal             @db.Decimal(18, 6)
  unitCost   Decimal             @map("unit_cost") @db.Decimal(18, 6)
  createdAt  DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([inputId], map: "idx_production_leftovers_input_id")
  @@index([lotId], map: "idx_production_leftovers_lot_id")
  @@map("production_leftovers")
}
```

Migration generated with `prisma migrate diff`, plus
`CHECK ("quantity" > 0)` and `CHECK ("unit_cost" >= 0)` on `production_leftovers`.

(The boolean is `hasLeftoversInCost` because the schema convention requires an `is`/`has` prefix.)

## Rule — `src/server/modules/productions/production-leftovers.ts` (pure)

```ts
/** What a lot holds after `taken` that is not a whole packaging of `content`; zero when none. */
export function leftoverOf(lotQuantity: Decimal, taken: Decimal, content: Decimal): Decimal;
```

`left = lotQuantity − taken`; `content ≤ 0` or `left ≤ 0` → 0; else `left mod content`.

## Server

- `stock.repository.ts`: `allocate` / `takeFromLots` takes expose, per take, the lot's
  `quantity` before the take and `packageContent` (already selected since #40).
- `productions.repository.ts`:
  - `consumeProductionInput` gains `discardsOpened: boolean`; when true, after the consumption,
    for each take from a lot with `packageContent`, writes off `leftoverOf(...)`: lowers the lot,
    lowers the stock balance, creates the `OPENED_LEFTOVER` movement at the lot's cost and the
    `ProductionLeftover` row. Returns `{ cost, leftoverCost }`.
  - `previewProductionLeftovers(productionId)`: same rule over `suggestLots`, writes nothing.
  - `findProductionById` selects each input's product `isStorableOnceOpened` and its leftovers.
- `productions.service.ts`:
  - `finishProduction` takes `hasLeftoversInCost` (default true), stores it, and adds the
    leftover cost of an item to its inputs cost when true.
  - `previewLeftovers(id)` → 404 unknown, 409 not in progress, else the preview.
- `finishProductionBodySchema` gains `hasLeftoversInCost: z.boolean().default(true)`.
- `GET /v1/productions/{id}/leftovers` (auth `PRODUCTION_READ`):
  `{ items: [{ itemId, leftovers: [{ product, lotId, quantity, unitCost, cost }] }], totalCost }`,
  cost and totalCost with 2 places.
- The production response gains `hasLeftoversInCost: boolean | null` and, per input,
  `leftovers: [{ lotId, quantity, unitCost }]`.
- `openapi.json` regenerated.

## Web

- `FinishProductionForm`: on open, calls the `previewLeftovers` action. With leftovers, a section
  **"Sobras que serão descartadas"**: one line per input, "Leite condensado: 95 g (R$ 1,90)"
  (quantity via `weighedOf` in the unit that reads best), and "Total: R$ 1,90"; then the checkbox
  "Incluir as sobras no custo da produção", checked. Without leftovers, neither. The finish sends
  `hasLeftoversInCost`. A failed preview shows "Não foi possível calcular as sobras." and still
  allows finishing.
- `ProductionDetailPage`: inputs table column "Sobra descartada" ("95 g · R$ 1,90" or "—");
  fact "Sobras no custo": "Sim" / "Não" (absent while in progress).
- `movement-types.ts`: `OPENED_LEFTOVER: { origin: "Sobra de embalagem aberta", direction: OUT }`.

## Tests (TDD: each one red first)

`production-leftovers.test.ts`
1. 3950 − 300, content 395 → 95; 3950 − 395 → 0; a lot with an old opened can, 3650 (9 cans +
   95 g) − 300 → 190 (both opened cans go); 100 − 100 → 0; content 0 → 0.

`productions` service (mocked repository)
2. finish with `hasLeftoversInCost` true adds the leftover cost to the unit cost; false does not;
   omitted counts as true; the choice is stored.
3. preview: 404 unknown, 409 finished.

Schema
4. `OPENED_LEFTOVER`, `ProductionLeftover` table, `hasLeftoversInCost` field; conventions hold.

Integration (CI)
5. Finishing with a non-storable ingredient from a lot of 10 × 395 g taking 300 g: the lot ends at
   3555, the balance drops by 395, one `OPENED_LEFTOVER` movement of 95 at the lot's cost, one
   `production_leftovers` row; unit cost includes R$ 1,90 when checked, not when unchecked.
6. A storable ingredient and a loose lot produce no leftover.
7. `GET /v1/productions/{id}/leftovers` returns the preview and writes nothing; CHECKs refuse a
   quantity of 0.

Web
8. `FinishProductionForm`: section with the line and total, checkbox checked, unchecking sends
   `hasLeftoversInCost: false`; no section without leftovers; failed preview message.
9. `ProductionDetailPage`: column and fact.
10. `StockMovementsPage`: "Sobra de embalagem aberta" as an exit.

## Out of scope

A leftovers report by period; changing the choice after finishing; leftovers of ingredients
consumed outside productions.
