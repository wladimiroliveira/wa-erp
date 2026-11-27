"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { moneyOf } from "@/features/stock/stock-format";
import type { PricingRow } from "@/lib/api";
import { formatDateOf } from "@/lib/dates";
import { formatDecimal } from "@/lib/decimal";

interface PricingSheetProps {
  /** The product whose price history to show, or `null` while none is open. */
  row: PricingRow | null;
  onClose: () => void;
}

/** The prices written for one product, newest first, each with the cost and markup it came from. */
export function PricingSheet({ row, onClose }: PricingSheetProps) {
  if (row === null) return null;

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-lg font-semibold">{row.product.description}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Custo médio</TableHead>
                <TableHead className="text-right">Markup</TableHead>
                <TableHead className="text-right">Preço</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row.history.map((entry) => (
                <TableRow key={entry.createdAt}>
                  <TableCell>{formatDateOf(entry.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{moneyOf(entry.averageCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDecimal(entry.markupPercent, 2)} %</TableCell>
                  <TableCell className="text-right tabular-nums">{moneyOf(entry.price)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  );
}
