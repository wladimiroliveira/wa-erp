"use client";

import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { moneyOf, quantityOf } from "@/features/stock/stock-format";
import type { PricingRow } from "@/lib/api";

interface PricingSheetProps {
  /** The product whose cost to break down, or `null` while none is open. */
  row: PricingRow | null;
  onClose: () => void;
}

/** What one unit of a product costs, ingredient by ingredient, as the recipe and the stock say. */
export function PricingSheet({ row, onClose }: PricingSheetProps) {
  if (row === null) return null;

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-lg font-semibold">{row.product.description}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-sm text-muted-foreground">Rendimento</dt>
              <dd className="font-semibold">{quantityOf(row.yieldQuantity, row.product.unit)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Custo por unidade</dt>
              <dd className="font-semibold">{moneyOf(row.costPerUnit)}</dd>
            </div>
          </dl>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingrediente</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="text-right">Custo médio</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row.ingredients.map(({ product, quantity, averageCost, subtotal }) => (
                <TableRow key={product.sku}>
                  <TableCell>{product.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{quantityOf(quantity, product.unit)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {averageCost === null ? <Badge variant="destructive">Sem custo médio</Badge> : moneyOf(averageCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{moneyOf(subtotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {row.status === "incomplete-cost" ? (
            <p className="text-sm text-muted-foreground">
              O custo só é calculado quando todos os ingredientes têm custo médio, que nasce na primeira entrada ou
              produção.
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
