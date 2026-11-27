"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { produceOf, produceProblem, REPLAN_DELAY_MS } from "@/features/pre-weighings/produce";
import { planProductionItem } from "@/features/productions/actions";
import { quantityOf } from "@/features/stock/stock-format";
import type { MeasurementUnit, PreWeighingPlan } from "@/lib/api";
import { formatDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { unitLabel } from "@/lib/units";

type PlanItem = PreWeighingPlan["items"][number];

// Every refusal of the plan is the server having decided, so none of them is worth trying again as it is.
export const PLAN_MESSAGES = {
  404: "Esse produto não existe mais. Atualize a página.",
  409: "Não foi possível calcular: o produto não tem receita, a receita usa um produto inativo ou a quantidade está fora do que a receita alcança.",
};

/** An item produced without a pre-weighing: what was asked, and the plan of it now on screen. */
export interface FreeItem {
  key: number;
  quantity: string;
  plan: PreWeighingPlan;
  /** A quantity to make waits to be planned, cannot be asked for, or its plan was refused: the item cannot start. */
  busy: boolean;
}

/** What the plan makes of each intermediate, at any depth, once per product, as the start takes it. */
export function produceOfPlan(plan: PreWeighingPlan): { productSku: string; quantity: string }[] {
  const made = new Map<string, string>();
  const visit = (stage: PreWeighingPlan) => {
    for (const { product, manufactured } of stage.items) {
      if (manufactured === null) continue;
      if (!made.has(product.sku)) made.set(product.sku, manufactured.toProduce);
      if (manufactured.stage !== null) visit(manufactured.stage);
    }
  };

  visit(plan);

  return [...made].map(([productSku, quantity]) => ({ productSku, quantity }));
}

interface Produce {
  typed: (sku: string) => string | undefined;
  error: (sku: string) => string | undefined;
  change: (sku: string, unit: MeasurementUnit, typed: string) => void;
}

/** A stage of the item's plan: what it takes of bought ingredients, and how much to make of each intermediate, with the stage of each one made below. */
function PlanStage({ plan, produce, nested }: { plan: PreWeighingPlan; produce: Produce; nested: boolean }) {
  const bought = plan.items.filter((item) => item.manufactured === null);
  const made = plan.items.filter(
    (item): item is PlanItem & { manufactured: NonNullable<PlanItem["manufactured"]> } => item.manufactured !== null,
  );

  return (
    <div className={nested ? "flex flex-col gap-2 border-l-2 pl-4" : "flex flex-col gap-2"}>
      {nested ? (
        <p className="text-sm font-medium">
          Fabricar {quantityOf(plan.quantity, plan.product.unit)} de {plan.product.description}
        </p>
      ) : null}

      {bought.length > 0 ? (
        <ul className="text-sm">
          {bought.map((input) => (
            <li key={input.product.sku}>
              {input.product.description}: {quantityOf(input.plannedQuantity, input.product.unit)}
            </li>
          ))}
        </ul>
      ) : null}
      {bought
        .filter((input) => Number(input.shortfall) > 0)
        .map((input) => (
          <p key={input.product.sku} className="text-sm text-destructive">
            Estoque insuficiente: falta {quantityOf(input.shortfall, input.product.unit)} de {input.product.description}
          </p>
        ))}

      {made.map(({ product, manufactured }) => {
        const error = produce.error(product.sku);

        return (
          <div key={product.sku} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{product.description}</span>
              <span>Necessário {quantityOf(manufactured.needed, product.unit)}</span>
              <span>No estoque {quantityOf(manufactured.inStock, product.unit)}</span>
              <span className="flex items-center gap-2">
                A fabricar
                {/* Zero takes it all from stock; more than it lacks stays in stock once made. */}
                <NumericInput
                  aria-label={`A fabricar de ${product.description}`}
                  className="w-28"
                  value={produce.typed(product.sku) ?? formatDecimal(manufactured.toProduce)}
                  onChange={(event) => produce.change(product.sku, product.unit, event.currentTarget.value)}
                />
                {unitLabel(product.unit)}
              </span>
            </div>
            {error !== undefined ? <p className="text-sm text-destructive">{error}</p> : null}
            {manufactured.stage !== null ? <PlanStage plan={manufactured.stage} produce={produce} nested /> : null}
          </div>
        );
      })}
    </div>
  );
}

interface FreeItemCardProps {
  item: FreeItem;
  onChange: (key: number, change: { plan?: PreWeighingPlan; busy: boolean }) => void;
  onRemove: (key: number) => void;
}

/** An added item and its tree of intermediates: a quantity to make typed plans the item again once the operator pauses. */
export function FreeItemCard({ item, onChange, onRemove }: FreeItemCardProps) {
  const { key, quantity, plan } = item;
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, string> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // The number of the latest ask: an answer to an older one arrives too late to be shown.
  const latestAsk = useRef(0);

  useEffect(() => {
    if (pending === null) return;

    const timer = setTimeout(() => {
      const ask = ++latestAsk.current;

      planProductionItem({ productSku: plan.product.sku, quantity }, pending)
        .then((result) => {
          if (ask !== latestAsk.current) return;
          setPending(null);

          if (!result.ok) {
            // The plan on screen stays; the item cannot start until a quantity plans again.
            setFailure(messageForFailure(result, PLAN_MESSAGES));
            onChange(key, { busy: true });
            return;
          }

          // What was typed stays: the next quantity typed is planned together with the earlier ones.
          setFailure(null);
          onChange(key, { plan: result.data, busy: false });
        })
        .catch((error: unknown) => {
          if (ask !== latestAsk.current) return;
          setPending(null);
          setFailure(messageForFailure(error));
          onChange(key, { busy: true });
        });
    }, REPLAN_DELAY_MS);

    return () => clearTimeout(timer);
  }, [pending, plan.product.sku, quantity, key, onChange]);

  const produce: Produce = {
    typed: (sku) => typed[sku],
    error: (sku) => errors[sku],
    change: (sku, unit, value) => {
      const next = { ...typed, [sku]: value };
      const problem = produceProblem(value, unit);
      const others = Object.fromEntries(Object.entries(errors).filter(([shown]) => shown !== sku));
      const nextErrors = problem === undefined ? others : { ...others, [sku]: problem };

      setTyped(next);
      setErrors(nextErrors);
      latestAsk.current += 1;

      if (Object.keys(nextErrors).length > 0) {
        setPending(null);
        onChange(key, { busy: true });
        return;
      }

      setPending(produceOf(next));
      onChange(key, { busy: true });
    },
  };

  return (
    <li className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">
          {plan.product.description} — {quantityOf(quantity, plan.product.unit)}
        </p>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Remover ${plan.product.description}`}
          onClick={() => onRemove(key)}
        >
          Remover
        </Button>
      </div>
      <PlanStage plan={plan} produce={produce} nested={false} />
      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
    </li>
  );
}
