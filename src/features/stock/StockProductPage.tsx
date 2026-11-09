"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { RowActions, RowActionsItem } from "@/components/common/RowActions";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { useSession } from "@/features/auth/use-session";
import { useUrlSearchParams } from "@/hooks/use-url-search-params";
import { LossDialog } from "@/features/losses/LossDialog";
import { amountOf, dayOf, moneyOf, NOTHING, packagingOf, quantityOf, unitCostOf } from "@/features/stock/stock-format";
import { PackagingCostsSection } from "@/features/stock/PackagingCostsSection";
import { lotStatusReading, statusReading } from "@/features/stock/stock-status";
import type { LossReason, ProductStock, StockLot } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { unitLabel } from "@/lib/units";
import { withValues } from "@/lib/url-filters";
import { PageTitle } from "@/components/layout/PageTitle";

interface StockProductPageProps {
  /** The position as the server read it, with the lots the address asked for. */
  stock: ProductStock;
  /** The reasons a loss may be recorded under. */
  reasons: LossReason[];
  /** Whether the address asked for the depleted lots as well. */
  depleted: boolean;
}

export function StockProductPage({ stock, reasons, depleted }: StockProductPageProps) {
  // Whether the depleted lots come in lives in the address, so the server reads the list once.
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const [loading, startLoading] = useTransition();
  const [writingOff, setWritingOff] = useState<StockLot | null>(null);
  const canWriteOff = useSession().can("LOSSES_CREATE");

  const { unit } = stock.product;

  // Ticking the box keeps the page on screen while the longer list is on its way.
  const setDepleted = (next: boolean) =>
    startLoading(() => setSearchParams(withValues(searchParams, "depleted", next ? ["true"] : [])));

  return (
    <div className="flex flex-col gap-4" aria-busy={loading}>
      <Link href="/stock" className="flex min-h-8 items-center self-start text-sm underline underline-offset-4">
        Voltar para a análise de estoque
      </Link>

      <PageTitle>{stock.product.description}</PageTitle>

      <dl role="group" aria-label="Resumo do produto" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border p-4">
          <dt className="text-sm text-muted-foreground">Saldo</dt>
          <dd className="text-xl font-semibold">{quantityOf(stock.quantity, unit)}</dd>
        </div>
        <div className="rounded-md border p-4">
          <dt className="text-sm text-muted-foreground">Valor em estoque</dt>
          <dd className="text-xl font-semibold">{moneyOf(stock.value)}</dd>
        </div>
        <div className="rounded-md border p-4">
          <dt className="text-sm text-muted-foreground">Próxima validade</dt>
          <dd className="text-xl font-semibold">{dayOf(stock.nextExpiresAt)}</dd>
        </div>
        <div className="rounded-md border p-4">
          <dt className="text-sm text-muted-foreground">Situação</dt>
          <dd>
            <Badge variant={statusReading(stock.status).badge}>{statusReading(stock.status).label}</Badge>
          </dd>
        </div>
      </dl>

      {stock.packagings.length === 0 ? null : <PackagingCostsSection packagings={stock.packagings} unit={unit} />}

      <div className="flex min-h-8 items-center gap-2">
        <Checkbox
          id="stock-depleted-lots"
          checked={depleted}
          onCheckedChange={(checked) => setDepleted(checked === true)}
        />
        <Label htmlFor="stock-depleted-lots" className="py-1.5">
          Mostrar lotes esgotados
        </Label>
      </div>

      {stock.lots.length === 0 ? (
        <p>{depleted ? "Nenhum lote registrado." : "Nenhum lote com saldo."}</p>
      ) : (
        <ArrangeableTable
          tableKey="stock-lots"
          rowNoun={{ one: "lote", other: "lotes" }}
          rows={stock.lots}
          rowKey={(lot) => lot.id}
          columns={[
            { key: "expiry", header: "Validade", cell: (lot) => dayOf(lot.expiresAt, "Sem validade") },
            { key: "supplier", header: "Fornecedor", cell: (lot) => lot.supplier?.name ?? NOTHING },
            { key: "entered-at", header: "Entrada", cell: (lot) => formatDateTime(lot.createdAt) },
            {
              key: "initial-quantity",
              header: "Qtd. inicial",
              cell: (lot) => amountOf(lot.initialQuantity),
            },
            { key: "quantity", header: "Saldo", cell: (lot) => amountOf(lot.quantity) },
            { key: "unit", header: "Un.", cell: () => unitLabel(unit) },
            { key: "unit-cost", header: "Custo unitário", cell: (lot) => unitCostOf(lot.unitCost, unit) },
            { key: "value", header: "Valor", cell: (lot) => moneyOf(lot.value) },
            {
              key: "packaging",
              header: "Embalagem",
              cell: (lot) =>
                lot.packaging === null
                  ? NOTHING
                  : `${lot.packaging.count} × ${packagingOf(lot.packaging.content, unit)}`,
            },
            { key: "package-price", header: "Preço emb.", cell: (lot) => moneyOf(lot.packaging?.price ?? null) },
            {
              key: "status",
              header: "Situação",
              cell: (lot) => (
                <Badge variant={lotStatusReading(lot.status).badge}>{lotStatusReading(lot.status).label}</Badge>
              ),
            },
            ...(canWriteOff
              ? [
                  {
                    key: "actions",
                    header: "Ações",
                    cell: (lot: StockLot) =>
                      lot.status === "DEPLETED" ? null : (
                        <RowActions label="Ações do lote">
                          <RowActionsItem onClick={() => setWritingOff(lot)}>Registrar avaria</RowActionsItem>
                        </RowActions>
                      ),
                  },
                ]
              : []),
          ]}
        />
      )}

      <LossDialog
        lot={writingOff}
        unit={unit}
        productName={stock.product.description}
        reasons={reasons}
        onOpenChange={(open) => setWritingOff(open ? writingOff : null)}
      />
    </div>
  );
}
