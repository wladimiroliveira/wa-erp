import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { weighedOf } from "@/features/pre-weighings/weighing-units";
import type { LeftoversPreview } from "@/lib/api";
import { formatMoney } from "@/lib/decimal";
import { fromScaled, toScaled } from "@/shared/fixed-point";
import { normalizeDecimal, readableQuantity } from "@/shared/units";

type Leftover = LeftoversPreview["items"][number]["leftovers"][number];

// One line per product, however many lots and items its leftovers come from.
function byProduct(preview: LeftoversPreview) {
  const lines = new Map<string, { product: Leftover["product"]; quantity: bigint; cost: bigint }>();

  for (const { product, quantity, cost } of preview.items.flatMap(({ leftovers }) => leftovers)) {
    const line = lines.get(product.sku) ?? { product, quantity: 0n, cost: 0n };

    lines.set(product.sku, {
      product,
      quantity: line.quantity + toScaled(quantity, 6),
      cost: line.cost + toScaled(cost, 2),
    });
  }

  return [...lines.values()].map(({ product, quantity, cost }) => ({
    product,
    quantity: normalizeDecimal(fromScaled(quantity, 6)),
    cost: fromScaled(cost, 2),
  }));
}

interface LeftoversSectionProps {
  preview: LeftoversPreview;
  inCost: boolean;
  onInCostChange: (inCost: boolean) => void;
}

/** What finishing will discard of the opened packagings, and whether its cost goes into the cost produced. */
export function LeftoversSection({ preview, inCost, onInCostChange }: LeftoversSectionProps) {
  return (
    <section aria-labelledby="finish-leftovers" className="flex flex-col gap-2">
      <h3 id="finish-leftovers" className="font-semibold">
        Sobras que serão descartadas
      </h3>
      <ul>
        {byProduct(preview).map(({ product, quantity, cost }) => (
          <li key={product.sku}>
            {product.description}: {weighedOf(quantity, product.unit, readableQuantity(quantity, product.unit).unit)} (
            {formatMoney(cost)})
          </li>
        ))}
      </ul>
      <p>Total: {formatMoney(preview.totalCost)}</p>
      <LeftoversInCostCheckbox inCost={inCost} onInCostChange={onInCostChange} />
    </section>
  );
}

/** Whether the cost of what is discarded goes into the cost produced: the user's to decide at finish. */
export function LeftoversInCostCheckbox({ inCost, onInCostChange }: Omit<LeftoversSectionProps, "preview">) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <Checkbox
        id="finish-leftovers-in-cost"
        checked={inCost}
        onCheckedChange={(checked) => onInCostChange(checked === true)}
      />
      <Label htmlFor="finish-leftovers-in-cost" className="flex-1 py-1.5">
        Incluir as sobras no custo da produção
      </Label>
    </div>
  );
}
