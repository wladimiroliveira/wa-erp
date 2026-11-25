"use client";

import { useState } from "react";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { weighedOf } from "@/features/pre-weighings/weighing-units";
import { moneyOf, NOTHING, quantityOf } from "@/features/stock/stock-format";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import type { ProductionItem } from "@/lib/api";
import { formatMoney } from "@/lib/decimal";
import { divideHalfUp, fromScaled, scale, toScaled } from "@/shared/fixed-point";
import { normalizeDecimal, readableQuantity } from "@/shared/units";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{children}</dd>
    </div>
  );
}

/**
 * Where an item came from, what it was to yield and what it took, kept behind a receipt button
 * left of the item's name or, in Feito, left of the line that finished or substituted it: the
 * screen itself shows what the operator acts on.
 */
export function ItemDetailsSheet({ item }: { item: ProductionItem }) {
  const [open, setOpen] = useState(false);
  const { unit } = item.product;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Detalhes de ${item.product.description}`}
        onClick={() => setOpen(true)}
      >
        <ReceiptText />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="text-lg font-semibold">{item.product.description}</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
            <dl className="grid grid-cols-2 gap-3">
              <Fact label="Origem">
                {item.status === "SUBSTITUTED" ? (
                  "Estoque"
                ) : item.preWeighingId !== null ? (
                  <Link href={`/pre-weighings/${item.preWeighingId}`} className="underline underline-offset-4">
                    Pré-pesagem
                  </Link>
                ) : (
                  "Receita"
                )}
              </Fact>
              <Fact label="Previsto">{quantityOf(item.expectedQuantity, unit)}</Fact>
              <Fact label="Produzido">{quantityOf(item.producedQuantity, unit)}</Fact>
              <Fact label="Custo unitário">{moneyOf(item.unitCost)}</Fact>
              {item.hasLeftoversInCost === null || !discardedAnyOf(item) ? null : (
                <Fact label="Sobras no custo">{item.hasLeftoversInCost ? "Sim" : "Não"}</Fact>
              )}
            </dl>

            <ArrangeableTable
              tableKey="production-item-inputs"
              rowNoun={{ one: "insumo", other: "insumos" }}
              rows={item.inputs}
              rowKey={(input) => input.product.sku}
              columns={[
                { key: "input", header: "Insumo", cell: (input) => input.product.description },
                {
                  key: "quantity",
                  header: "Quantidade",
                  cell: (input) => quantityOf(input.quantity, input.product.unit),
                },
                // Known only once the item finishes: it is what the lots the input left cost.
                { key: "unitCost", header: "Custo unitário", cell: (input) => moneyOf(input.unitCost) },
                // Only where something was discarded: elsewhere it would be a column of dashes.
                ...(discardedAnyOf(item) ? [{ key: "leftover", header: "Sobra descartada", cell: discardedOf }] : []),
              ]}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

type Input = ProductionItem["inputs"][number];

const discardedAnyOf = ({ inputs }: ProductionItem) => inputs.some(({ leftovers }) => leftovers.length > 0);

// What finishing discarded of the input's opened packagings, "95 g · R$ 1,90", priced at each lot's cost.
function discardedOf({ product, leftovers }: Input): string {
  if (leftovers.length === 0) return NOTHING;

  const quantity = leftovers.reduce((sum, leftover) => sum + toScaled(leftover.quantity, 6), 0n);
  const cost = leftovers.reduce(
    (sum, leftover) => sum + toScaled(leftover.quantity, 6) * toScaled(leftover.unitCost, 6),
    0n,
  );
  const amount = normalizeDecimal(fromScaled(quantity, 6));
  const shown = weighedOf(amount, product.unit, readableQuantity(amount, product.unit).unit);

  return `${shown} · ${formatMoney(fromScaled(divideHalfUp(cost, scale(10)), 2))}`;
}
