import { Button } from "@/components/ui/button";
import { weighedOf } from "@/features/pre-weighings/weighing-units";
import { quantityOf } from "@/features/stock/stock-format";
import type { MeasurementUnit, PreWeighingWaste, WasteSuggestion } from "@/lib/api";
import { formatMoney } from "@/lib/decimal";
import { readableQuantity } from "@/shared/units";

interface WasteSectionProps {
  waste: PreWeighingWaste;
  /** The unit of the product to produce, which the quantities are written in. */
  unit: MeasurementUnit;
  /** Asks the plan again for a quantity suggested, in the API's writing. */
  onProduce: (quantity: string) => void;
}

/** "10 kg: perda de R$ 3,20 (160 g de Leite condensado)", or "10 kg: sem sobras". */
function lineOf({ quantity, loss, leftovers }: WasteSuggestion, unit: MeasurementUnit): string {
  const produced = quantityOf(quantity, unit);

  if (leftovers.length === 0) return `${produced}: sem sobras`;

  const left = leftovers
    .map(({ product, leftover }) => {
      const shown = weighedOf(leftover, product.unit, readableQuantity(leftover, product.unit).unit);

      return `${shown} de ${product.description}`;
    })
    .join(", ");

  return `${produced}: perda de ${formatMoney(loss)} (${left})`;
}

/** What the opened packagings of the ingredients that cannot be kept would leave behind, and quantities that leave less. */
export function WasteSection({ waste, unit, onProduce }: WasteSectionProps) {
  return (
    <section aria-labelledby="pre-weighing-waste" className="flex flex-col gap-2 rounded-md border p-4">
      <h2 id="pre-weighing-waste" className="text-lg font-semibold">
        Sobras de abertos
      </h2>

      <p>{lineOf(waste.requested, unit)}</p>

      {waste.alternatives.length === 0 ? (
        <p className="text-muted-foreground">
          {/* Leftovers without a cost weigh nothing in the comparison, so it cannot say they would not shrink. */}
          {waste.uncosted.length === 0
            ? `Nenhuma quantidade até +${waste.tolerance}% reduz as sobras.`
            : `Nenhuma quantidade até +${waste.tolerance}% reduz a perda calculada; o que não tem custo médio ficou fora da comparação.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {waste.alternatives.map((alternative) => (
            <li key={alternative.quantity} className="flex flex-wrap items-center gap-2">
              <span>{lineOf(alternative, unit)}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => onProduce(alternative.quantity)}>
                Produzir {quantityOf(alternative.quantity, unit)}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {waste.unpackaged.map((product) => (
        <p key={`unpackaged-${product.sku}`} className="text-sm text-muted-foreground">
          {product.description}: sem embalagem conhecida.
        </p>
      ))}
      {waste.uncosted.map((product) => (
        <p key={`uncosted-${product.sku}`} className="text-sm text-muted-foreground">
          {product.description}: sem custo médio.
        </p>
      ))}
    </section>
  );
}
