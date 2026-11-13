"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { weighedOf } from "@/features/pre-weighings/weighing-units";
import { reduceProductionItem } from "@/features/productions/actions";
import type { FinishConflict, MeasurementUnit, Production } from "@/lib/api";
import { toApiDecimal, toDecimalInput } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { fitsPlacesOf, positiveDecimal } from "@/lib/form-schemas";
import { fromScaled, scale, toScaled } from "@/shared/fixed-point";
import { normalizeDecimal, pickPlacesOf, readableQuantity } from "@/shared/units";

type Shortage = NonNullable<FinishConflict["shortages"]>[number];
type ProductionItem = Production["items"][number];

const PLACES = 6;

const REDUCE_MESSAGES = {
  404: "Essa produção ou esse item não existe mais.",
  409: "A nova quantidade precisa ser menor que a prevista e caber nas casas decimais da unidade, ou a produção já foi finalizada ou cancelada.",
};

// A quantity of the item's product, at the places its unit is picked with, as the server takes it.
function reduceFormSchemaOf(unit: MeasurementUnit) {
  const places = pickPlacesOf(unit);
  const message =
    places === 0 ? "Informe uma quantidade inteira." : `Informe a nova quantidade, com até ${places} casas decimais.`;

  return z.object({
    quantity: positiveDecimal(message, "A nova quantidade deve ser maior que zero.").refine(
      (typed) => fitsPlacesOf(typed, unit),
      message,
    ),
  });
}

type ReduceFormValues = z.infer<ReturnType<typeof reduceFormSchemaOf>>;

// The unit-aware formatting works on amounts that are not negative, and a stock balance can be
// below zero: the amount is formatted without its sign, and the sign put back in front.
function shownOf(quantity: string, unit: Shortage["product"]["unit"]): string {
  const negative = quantity.startsWith("-");
  const amount = negative ? quantity.slice(1) : quantity;

  return `${negative ? "-" : ""}${weighedOf(amount, unit, readableQuantity(amount, unit).unit)}`;
}

// A positive amount scaled to `PLACES`, rounded up to a quantity of the unit the operator could pick:
// a new weighing of it covers what is missing.
function roundUp(amount: bigint, unit: MeasurementUnit): bigint {
  const step = scale(PLACES - pickPlacesOf(unit));

  return ((amount + step - 1n) / step) * step;
}

// One line per short product: items that share an intermediate draw on the same balance, so what
// they need is summed, while the balance is the same in every entry of that product.
function byProduct(production: Production, shortages: Shortage[]) {
  const lines = new Map<
    string,
    { product: Shortage["product"]; needed: bigint; available: string; itemIds: Set<string> }
  >();

  for (const { itemId, product, needed, available } of shortages) {
    const line = lines.get(product.sku) ?? { product, needed: 0n, available, itemIds: new Set<string>() };

    line.needed += toScaled(needed, PLACES);
    line.itemIds.add(itemId);
    lines.set(product.sku, line);
  }

  return [...lines.values()].map(({ product, needed, available, itemIds }) => {
    // The weighing hangs from the pre-weighing that guides the first of these items, in the
    // production's order, that has one; free items have none to hang it from.
    const guide = production.items.find((item) => itemIds.has(item.id) && item.preWeighingId !== null);

    return {
      product,
      needed: normalizeDecimal(fromScaled(needed, PLACES)),
      available,
      missing: normalizeDecimal(fromScaled(roundUp(needed - toScaled(available, PLACES), product.unit), PLACES)),
      parentId: guide?.preWeighingId ?? null,
    };
  });
}

interface ShortageDialogProps {
  production: Production;
  conflict: FinishConflict;
  onClose(): void;
  onReduced(production: Production): void;
}

/** What the stock lacks of the intermediates to finish, and the two ways out: weigh more, or make less. */
export function ShortageDialog({ production, conflict, onClose, onReduced }: ShortageDialogProps) {
  const lines = byProduct(production, conflict.shortages ?? []);
  const reducible = (conflict.items ?? []).flatMap(({ itemId, maxQuantity }) => {
    const item = production.items.find((found) => found.id === itemId);

    return item === undefined ? [] : [{ item, maxQuantity }];
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Falta material intermediário</DialogTitle>
          <DialogDescription>O estoque não tem o bastante para finalizar a produção.</DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2">
          {lines.map(({ product, needed, available, missing, parentId }) => (
            <li key={product.sku} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {product.description}: precisa {shownOf(needed, product.unit)}, tem {shownOf(available, product.unit)}
              </span>
              {parentId !== null ? (
                <Link
                  href={`/pre-weighings/new?${new URLSearchParams({ parentId, productSku: product.sku, quantity: missing })}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Nova pesagem
                </Link>
              ) : null}
            </li>
          ))}
        </ul>

        {reducible.map(({ item, maxQuantity }) => (
          <ReduceItemForm
            key={item.id}
            productionId={production.id}
            item={item}
            maxQuantity={maxQuantity}
            onReduced={onReduced}
          />
        ))}
      </DialogContent>
    </Dialog>
  );
}

interface ReduceItemFormProps {
  productionId: string;
  item: ProductionItem;
  maxQuantity: string;
  onReduced(production: Production): void;
}

// Starts at the most the stock allows, so taking it is one click.
function ReduceItemForm({ productionId, item, maxQuantity, onReduced }: ReduceItemFormProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const [reducing, startReducing] = useTransition();
  const form = useForm<ReduceFormValues>({
    resolver: zodResolver(reduceFormSchemaOf(item.product.unit)),
    defaultValues: { quantity: toDecimalInput(maxQuantity) },
  });
  const fieldId = `reduce-${item.id}-quantity`;
  const legendId = `reduce-${item.id}-legend`;
  const error = form.formState.errors.quantity;

  function reduce({ quantity }: ReduceFormValues): void {
    setFailure(null);
    startReducing(async () => {
      try {
        const result = await reduceProductionItem(productionId, item.id, toApiDecimal(quantity));

        if (!result.ok) {
          setFailure(messageForFailure(result, REDUCE_MESSAGES));
          return;
        }

        onReduced(result.data);
      } catch (caught) {
        setFailure(messageForFailure(caught));
      }
    });
  }

  return (
    <form
      onSubmit={form.handleSubmit(reduce)}
      role="group"
      aria-labelledby={legendId}
      className="flex flex-col gap-2 rounded-md border p-3"
      noValidate
    >
      <p id={legendId} className="font-semibold">
        {item.product.description}
      </p>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={fieldId}>Nova quantidade</Label>
          <NumericInput id={fieldId} {...form.register("quantity")} />
        </div>
        <Button type="submit" variant="outline" disabled={reducing}>
          Reduzir
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
    </form>
  );
}
