"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { planProductionItem, weighItem } from "@/features/productions/actions";
import { progressOf } from "@/features/productions/batch-progress";
import {
  isWeighed,
  toProductUnit,
  WEIGHED_MESSAGE,
  weighedOf,
  weighingUnitOf,
} from "@/features/pre-weighings/weighing-units";
import type { MeasurementUnit, PreWeighingPlan, Production, ProductionItem } from "@/lib/api";
import { formatDecimal, toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { fitsPlacesOf } from "@/lib/form-schemas";
import { unitLabel } from "@/lib/units";
import { PLAN_MISMATCHES } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { pickPlacesOf } from "@/shared/units";

type PlanItem = PreWeighingPlan["items"][number];

const PLAN_MESSAGES = {
  404: "Esse produto não existe mais. Atualize a página.",
  409: "Não foi possível calcular: o produto não tem receita, a receita usa um produto inativo ou a quantidade está fora do que a receita alcança.",
};
const WEIGH_MESSAGES = {
  404: "Essa produção não existe mais.",
  409: "Um item mudou enquanto isso. A página foi atualizada.",
};
// What was weighed no longer matches what the recipe plans: the plan on screen is what is out of date.
const RECALCULATE = "A receita ou o produto mudou. Calcule de novo.";
const PLAN_MISMATCH_MESSAGES: Record<string, string> = {
  [PLAN_MISMATCHES.items]: RECALCULATE,
  [PLAN_MISMATCHES.stage]: RECALCULATE,
};
/** The unit an ingredient is weighed in: the one its planned quantity reads best in. */
const weighedUnitOf = ({ product, plannedQuantity }: PlanItem): MeasurementUnit =>
  weighingUnitOf(product.unit, plannedQuantity);

interface ItemWeighingPanelProps {
  production: Production;
  item: ProductionItem;
  /** Called once the weighing is recorded, so the card can close the panel. */
  onDone?: () => void;
}

/**
 * Weighs the ingredients of one more leva of an item inside its card: how much to make, the plan of
 * the recipe for it and what the scale showed for each ingredient bought.
 */
export function ItemWeighingPanel({ production, item, onDone }: ItemWeighingPanelProps) {
  const router = useRouter();
  const { product } = item;
  const [initial] = useState(() =>
    formatDecimal(item.awaitsWeighing ? item.expectedQuantity : progressOf(item).missing),
  );
  const [quantity, setQuantity] = useState(initial);
  const [plan, setPlan] = useState<PreWeighingPlan | null>(null);
  const [weighed, setWeighed] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const places = pickPlacesOf(product.unit);
  const quantityMessage =
    places === 0 ? "Informe uma quantidade inteira." : `Informe a quantidade, com até ${places} casas decimais.`;

  // Asks the plan for a quantity already known to be valid.
  const planFor = useCallback(
    (typed: string) =>
      startTransition(async () => {
        try {
          const result = await planProductionItem({ productSku: product.sku, quantity: toApiDecimal(typed) });

          if (!result.ok) {
            setFailure(messageForFailure(result, PLAN_MESSAGES));
            return;
          }

          setPlan(result.data);
          setWeighed({});
          setErrors({});
        } catch (error) {
          setFailure(messageForFailure(error));
        }
      }),
    [product.sku],
  );

  function calculate(typed: string): void {
    setFailure(null);

    if (!fitsPlacesOf(typed, product.unit) || Number(toApiDecimal(typed)) <= 0) {
      setQuantityError(quantityMessage);
      return;
    }

    setQuantityError(null);
    planFor(typed);
  }

  // Opened to be used: the plan for the starting quantity is already there. A starting quantity of
  // zero (nothing missing) is left for the operator to type.
  useEffect(() => {
    if (Number(toApiDecimal(initial)) > 0) planFor(initial);
  }, [initial, planFor]);

  function submit(): void {
    if (plan === null) return;

    setFailure(null);
    const bought = plan.items.filter((line) => line.manufactured === null);
    const invalid = Object.fromEntries(
      bought.filter((line) => !isWeighed(weighed[line.product.sku])).map((line) => [line.product.sku, WEIGHED_MESSAGE]),
    );
    setErrors(invalid);

    if (Object.keys(invalid).length > 0) return;

    // The plan says what it was for: a quantity typed since then is not what was planned.
    const items = plan.items.map((line) =>
      line.manufactured === null
        ? {
            productSku: line.product.sku,
            weighedQuantity: toProductUnit(weighed[line.product.sku]!, weighedUnitOf(line), line.product.unit),
          }
        : { productSku: line.product.sku },
    );

    startTransition(async () => {
      try {
        const result = await weighItem(production.id, item.id, { quantity: plan.quantity, items });

        if (!result.ok) {
          const mismatch = result.status === 409 ? PLAN_MISMATCH_MESSAGES[result.message] : undefined;

          if (mismatch !== undefined) {
            setFailure(mismatch);
          } else if (result.status === 409) {
            // The item changed under the panel: the page brought anew shows it as it is now.
            toast.error(messageForFailure(result, WEIGH_MESSAGES));
            router.refresh();
          } else {
            setFailure(messageForFailure(result, WEIGH_MESSAGES));
          }
          return;
        }

        toast.success("Pesagem registrada.");
        onDone?.();
        router.refresh();
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  const description = product.description;
  const quantityId = `weighing-${item.id}-quantity`;

  return (
    <div role="group" aria-label={`Pesagem de ${description}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={quantityId}>Quanto fazer</Label>
          <NumericInput
            id={quantityId}
            className="w-32 bg-background"
            value={quantity}
            onChange={(event) => {
              setQuantity(event.currentTarget.value);
              // What is on screen was planned for another quantity.
              setPlan(null);
            }}
          />
        </div>
        <Button type="button" variant="outline" disabled={pending} onClick={() => calculate(quantity)}>
          Calcular
        </Button>
      </div>
      {quantityError !== null ? <p className="text-sm text-destructive">{quantityError}</p> : null}

      {plan !== null ? (
        <ul className="flex flex-col gap-2 text-sm">
          {plan.items.map((line) => {
            const unit = weighedUnitOf(line);
            const sku = line.product.sku;

            return (
              <li key={sku} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{line.product.description}</span>
                  {line.manufactured !== null ? (
                    <span className="text-muted-foreground">do estoque</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground tabular-nums">
                        {weighedOf(line.plannedQuantity, line.product.unit, unit)}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <NumericInput
                          aria-label={`Pesado de ${line.product.description}`}
                          className="w-28 bg-background"
                          value={weighed[sku] ?? ""}
                          onChange={(event) => {
                            const typed = event.currentTarget.value;

                            setWeighed((current) => ({ ...current, [sku]: typed }));
                          }}
                        />
                        <span>{unitLabel(unit)}</span>
                      </div>
                    </>
                  )}
                </div>
                {errors[sku] !== undefined ? <p className="text-sm text-destructive">{errors[sku]}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      <div>
        <Button type="button" disabled={pending || plan === null} onClick={submit}>
          Registrar pesagem
        </Button>
      </div>
    </div>
  );
}
