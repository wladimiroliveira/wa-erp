# Pre-weighing waste suggestions — design

Date: 2026-11-08
Branch: `feat/pre-weighing-waste`
Issue: #29 (part 4b of the enhancement milestone; builds on packagings #35, entries by packaging #36,
pre-weighing units #39)

## Goal

Some ingredients cannot be kept once their packaging is opened (condensed milk, liquid milk, cream):
what is left of the can or carton is lost. When planning a pre-weighing, suggest production
quantities a little above the one asked for that leave less of these ingredients behind, priced in
reais, without producing much more than was asked.

Ingredients that keep once opened (sugar, cocoa powder, powdered milk) go to containers of their
own and lose the idea of a packaging: they take no part in the suggestion and the system never
tells which packaging of them to open.

## Decisions

- **Products say whether they keep once opened** (`isStorableOnceOpened`, default yes). Only the ones
  that do not are counted.
- **The packaging counted is the one of the first lot the plan suggests** (the next to expire). An
  ingredient whose first suggested lot came in loose, or whose stock has no lot, is left out of the
  count with a warning "sem embalagem conhecida".
- **Suggestions are ranked by the money lost**: each leftover × the ingredient's average cost,
  summed. An ingredient without an average cost shows its leftover but stays out of the sum, with
  a warning.
- **A limit in %, default 20, editable on the screen**, bounds how much more may be produced.
- **The rule lives in the service**: the plan endpoint returns the suggestions.

## Data

`Product` gains:

```prisma
isStorableOnceOpened Boolean @default(true) @map("is_storable_once_opened")
```

Migration `ALTER TABLE "products" ADD COLUMN "is_storable_once_opened" BOOLEAN NOT NULL DEFAULT true;`
(generated with `prisma migrate diff`).

Products module: `isStorableOnceOpened` optional in create and update bodies (create defaults to
`true`), present in the product response. `ProductDialog`: checkbox "Pode ser guardado depois de
aberto", checked by default.

## Calculation — `src/server/modules/pre-weighings/pre-weighings.plan.ts`

Pure, exact decimals (`Prisma.Decimal`), no float:

```ts
type WasteIngredient = {
  product: ProductSummary;
  recipeQuantity: Decimal; // what the recipe takes of it for yieldQuantity
  content: Decimal;        // the packaging's content, in the ingredient's unit
  averageCost: Decimal | null;
};

export function suggestQuantities(input: {
  quantity: Decimal;         // asked for
  yieldQuantity: Decimal;
  unit: MeasurementUnit;     // the produced product's unit
  tolerance: number;         // percent, 0..100
  ingredients: WasteIngredient[];
}): { requested: Suggestion; alternatives: Suggestion[] };

type Suggestion = {
  quantity: Decimal;
  loss: Decimal; // 2 places, half up; sum of the costed leftovers
  leftovers: { product: ProductSummary; leftover: Decimal; loss: Decimal | null }[];
};
```

- Need of an ingredient for Q: `q = recipeQuantity × Q ÷ yieldQuantity`.
- Leftover: `⌈q ÷ content⌉ × content − q` (zero when q fills whole packagings). Leftovers of zero
  are not listed.
- Loss: `leftover × averageCost`, summed, rounded to cents at the end.
- Candidates, all within `[Q, Q × (1 + tolerance/100)]`:
  - the maximum `Q × (1 + tolerance/100)`;
  - for each ingredient and each whole k, `k × content × yieldQuantity ÷ recipeQuantity`.
  - Each candidate is taken both rounded **down** and rounded **up** to an integer when the unit
    is UNIT, to 3 places otherwise, and each rounding kept only if within the range. Both are
    needed: 8 cans of 395 g at 300 g per kg close at 10.5333… kg; 10,533 kg leaves 0,1 g, while
    10,534 kg opens a ninth can.
- `alternatives`: the candidates with a loss lower than the requested one, the lowest loss first,
  then the smaller quantity; duplicates removed; at most 3.

## Server — `GET /v1/pre-weighings/plan`

- `preWeighingPlanQuerySchema` gains `tolerance: z.coerce.number().int().min(0).max(100).default(20)`.
- `previewPreWeighing` builds the waste ingredients from the recipe (non-keeping ingredients),
  the packaging of each one's first suggested lot (`suggestLots` returns the lot; the lot query
  includes `packaging.content`), and the average cost from the stock. Recording is unchanged.
- The response gains:

```ts
waste: null | {
  tolerance: number;
  requested: Suggestion;      // decimals as strings
  alternatives: Suggestion[];
  unpackaged: ProductSummary[]; // non-keeping ingredients with no packaging known
  uncosted: ProductSummary[];   // counted ingredients with no average cost
}
```

  `waste` is null when the recipe takes no non-keeping ingredient.
- `openapi.json` regenerated.

## Web — `PreWeighingPage`

- Next to "Quantidade a produzir", a field "Aceitar até" with suffix "%", prefilled with 20,
  integer 0–100 ("Informe um número inteiro de 0 a 100."), sent with Calcular.
- When `waste` is not null, a section **"Sobras de abertos"** above the table:
  - The requested line: "10 kg: perda de R$ 4,20 (300 ml de Creme de leite)" or
    "10 kg: sem sobras".
  - Each alternative in the same words, with a button "Produzir 10,8 kg" that puts the quantity in
    the field and calculates again.
  - No alternative: "Nenhuma quantidade até +20% reduz as sobras."
  - Warnings: "Creme de leite: sem embalagem conhecida." and "Leite condensado: sem custo médio."
  - Leftovers shown with `weighedOf` in the unit that reads best, up to 3 places.

## Tests (TDD: each one red first)

`pre-weighings.plan.test.ts` (`suggestQuantities`)
1. A recipe taking 395 g of condensed milk (can 395 g) per 1 kg: 10 kg leaves nothing → no
   alternatives.
2. 300 g per 1 kg, can 395 g, average cost 0.02/g, Q 10 kg, tolerance 20: requested needs
   3000 g, opens 8 cans (3160 g), leaves 160 g, loss R$ 3,20; the first alternative is 10,533 kg
   (leftover 0,1 g, loss R$ 0,00), and 10,534 kg is not offered (it opens a ninth can).
3. Two ingredients ranked by summed loss; an uncosted ingredient listed with `loss: null` and out
   of the sum.
4. A UNIT product rounds candidates up to integers; candidates past the limit are dropped.
5. Tolerance 0 yields no alternatives.

`pre-weighings` service / route (repository mocked or integration)
6. `waste` is null with no non-keeping ingredient; `unpackaged` lists one whose first lot came
   loose; `tolerance` out of 0–100 → 400.

Products
7. `isStorableOnceOpened` defaults to true on create, can be set false, is returned; dialog checkbox
   sends it.

`PreWeighingPage.test.tsx`
8. The tolerance field is sent with the plan; out of range refused.
9. The section shows the requested line, alternatives with "Produzir …" (which recalculates with
   that quantity), "sem sobras", the no-alternative sentence and the warnings.

Integration (CI)
10. Plan endpoint with a non-keeping ingredient in packaged lots returns `waste` with the expected
    numbers; schema test for `is_storable_once_opened`.

## Out of scope

Tracking opened packagings in the stock; shelf life once opened; ingredients of sub-recipes; the
recorded pre-weighing remembering the suggestion.
