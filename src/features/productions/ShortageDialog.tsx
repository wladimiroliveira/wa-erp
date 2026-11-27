"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addShortageItem } from "@/features/productions/actions";
import { weighedOf } from "@/features/pre-weighings/weighing-units";
import type { FinishConflict, MeasurementUnit, Production } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";
import { fromScaled, scale, toScaled } from "@/shared/fixed-point";
import { normalizeDecimal, pickPlacesOf, readableQuantity } from "@/shared/units";

type Shortage = NonNullable<FinishConflict["shortages"]>[number];

const PLACES = 6;

const ADD_MESSAGES = {
  404: "A produção mudou enquanto isso. Atualize a página.",
  409: "A produção mudou enquanto isso. Atualize a página.",
};

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
function byProduct(shortages: Shortage[]) {
  const lines = new Map<string, { product: Shortage["product"]; needed: bigint; available: string }>();

  for (const { product, needed, available } of shortages) {
    const line = lines.get(product.sku) ?? { product, needed: 0n, available };

    line.needed += toScaled(needed, PLACES);
    lines.set(product.sku, line);
  }

  return [...lines.values()].map(({ product, needed, available }) => ({
    product,
    needed: normalizeDecimal(fromScaled(needed, PLACES)),
    available,
    missing: normalizeDecimal(fromScaled(roundUp(needed - toScaled(available, PLACES), product.unit), PLACES)),
  }));
}

interface ShortageDialogProps {
  production: Production;
  conflict: FinishConflict;
  onClose(): void;
}

/** What the stock lacks of the intermediates to finish, and the way out: one more item of each, to weigh and make. */
export function ShortageDialog({ production, conflict, onClose }: ShortageDialogProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();
  const lines = byProduct(conflict.shortages ?? []);

  function add(productSku: string, quantity: string): void {
    setFailure(null);
    startAdding(async () => {
      try {
        const result = await addShortageItem(production.id, { productSku, quantity });

        if (!result.ok) {
          setFailure(messageForFailure(result, ADD_MESSAGES));
          return;
        }

        onClose();
        router.refresh();
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

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
          {lines.map(({ product, needed, available, missing }) => (
            <li key={product.sku} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {product.description}: precisa {shownOf(needed, product.unit)}, tem {shownOf(available, product.unit)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={adding}
                onClick={() => add(product.sku, missing)}
              >
                Nova pesagem
              </Button>
            </li>
          ))}
        </ul>

        {failure !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
