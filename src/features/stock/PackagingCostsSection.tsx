"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { moneyOf, NOTHING, packagingOf, unitCostOf } from "@/features/stock/stock-format";
import type { MeasurementUnit, PackagingCost } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { HISTORY_LIMIT } from "@/server/modules/stock/stock.schemas";
import { packageUnitCost } from "@/shared/packaging-entry";

interface PackagingCostsSectionProps {
  packagings: PackagingCost[];
  /** The unit the product is kept in, which the contents are written in. */
  unit: MeasurementUnit;
}

const NEVER = "Sem entradas";

/** What each packaging of the product was bought at, last and over time. */
export function PackagingCostsSection({ packagings, unit }: PackagingCostsSectionProps) {
  // The packaging stays chosen while its dialog closes, so the dialog does not empty as it animates out.
  const [showing, setShowing] = useState<PackagingCost | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="stock-packagings" className="flex flex-col gap-2">
      <h2 id="stock-packagings" className="text-lg font-semibold">
        Embalagens
      </h2>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Embalagem</TableHead>
            <TableHead>Último preço</TableHead>
            <TableHead>Equivale a</TableHead>
            <TableHead>Última entrada</TableHead>
            <TableHead>Fornecedor</TableHead>
            <TableHead>
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packagings.map((packaging) => {
            const label = packagingOf(packaging.content, unit);
            const { lastEntry } = packaging;

            return (
              <TableRow key={packaging.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {label}
                    {packaging.isActive ? null : <Badge variant="secondary">Inativa</Badge>}
                  </span>
                </TableCell>
                {lastEntry === null ? (
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {NEVER}
                  </TableCell>
                ) : (
                  <>
                    <TableCell>{moneyOf(lastEntry.price)}</TableCell>
                    <TableCell>{unitCostOf(packageUnitCost(lastEntry.price, packaging.content), unit)}</TableCell>
                    <TableCell>{formatDateTime(lastEntry.createdAt)}</TableCell>
                    <TableCell>{lastEntry.supplier?.name ?? NOTHING}</TableCell>
                  </>
                )}
                <TableCell>
                  {packaging.history.length === 0 ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Histórico de ${label}`}
                      onClick={() => {
                        setShowing(packaging);
                        setOpen(true);
                      }}
                    >
                      Histórico
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {showing === null ? null : (
            <>
              <DialogHeader>
                <DialogTitle>Entradas de {packagingOf(showing.content, unit)}</DialogTitle>
              </DialogHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Quantidade</TableHead>
                    <TableHead>Preço</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {showing.history.map((entry) => (
                    <TableRow key={entry.lotId}>
                      <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                      <TableCell>{entry.supplier?.name ?? NOTHING}</TableCell>
                      <TableCell>{entry.count}</TableCell>
                      <TableCell>{moneyOf(entry.price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {showing.history.length >= HISTORY_LIMIT ? (
                <p className="text-sm text-muted-foreground">Mostrando as {HISTORY_LIMIT} entradas mais recentes.</p>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
