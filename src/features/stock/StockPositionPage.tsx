"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import Link from "next/link";
import { amountOf, dayOf, unitCostOf } from "@/features/stock/stock-format";
import { needsAttention, statusReading } from "@/features/stock/stock-status";
import type { StockPosition } from "@/lib/api";
import { formatMoney } from "@/lib/decimal";
import { unitLabel } from "@/lib/units";
import { PageTitle } from "@/components/layout/PageTitle";

export function StockPositionPage({ position }: { position: StockPosition }) {
  const [onlyAttention, setOnlyAttention] = useState(false);

  const { items } = position;
  const attention = items.filter((item) => needsAttention(item.status));
  const shown = onlyAttention ? attention : items;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Análise de estoque</PageTitle>

      {items.length === 0 ? <p>Nenhum produto cadastrado ainda.</p> : null}

      {items.length > 0 ? (
        <>
          <dl role="group" aria-label="Resumo do estoque" className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-4">
              <dt className="text-sm text-muted-foreground">Valor em estoque</dt>
              <dd className="text-xl font-semibold">{formatMoney(position.totalValue)}</dd>
            </div>
            <div className="rounded-md border p-4">
              <dt className="text-sm text-muted-foreground">Produtos</dt>
              <dd className="text-xl font-semibold">{items.length}</dd>
            </div>
            <div className="rounded-md border p-4">
              <dt className="text-sm text-muted-foreground">Pedem atenção</dt>
              <dd className="text-xl font-semibold">{attention.length}</dd>
            </div>
          </dl>

          <div className="flex min-h-8 items-center gap-2">
            <Checkbox
              id="stock-only-attention"
              checked={onlyAttention}
              onCheckedChange={(checked) => setOnlyAttention(checked === true)}
            />
            <Label htmlFor="stock-only-attention" className="py-1.5">
              Só o que pede atenção
            </Label>
          </div>

          {shown.length === 0 ? (
            <p>Nenhum produto pede atenção.</p>
          ) : (
            <ArrangeableTable
              tableKey="stock-position"
              rowNoun={{ one: "produto", other: "produtos" }}
              fill
              rows={shown}
              rowKey={(item) => item.product.sku}
              columns={[
                {
                  key: "product",
                  header: "Produto",
                  cell: (item) => (
                    <Link
                      href={`/stock/${item.product.sku}`}
                      className="flex min-h-8 items-center underline underline-offset-4"
                    >
                      {item.product.description}
                    </Link>
                  ),
                },
                { key: "quantity", header: "Saldo", cell: (item) => amountOf(item.quantity) },
                { key: "unit", header: "Un.", cell: (item) => unitLabel(item.product.unit) },
                { key: "minimum", header: "Mínimo", cell: (item) => amountOf(item.minimumQuantity) },
                { key: "lots", header: "Lotes", cell: (item) => item.lotCount },
                { key: "next-expiry", header: "Próxima validade", cell: (item) => dayOf(item.nextExpiresAt) },
                {
                  key: "last-cost",
                  header: "Último custo",
                  cell: (item) => unitCostOf(item.lastEntryCost, item.product.unit),
                },
                {
                  key: "average-cost",
                  header: "Custo médio",
                  cell: (item) => unitCostOf(item.averageCost, item.product.unit),
                },
                { key: "value", header: "Valor", cell: (item) => formatMoney(item.value) },
                {
                  key: "status",
                  header: "Situação",
                  cell: (item) => (
                    <Badge variant={statusReading(item.status).badge}>{statusReading(item.status).label}</Badge>
                  ),
                },
              ]}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
