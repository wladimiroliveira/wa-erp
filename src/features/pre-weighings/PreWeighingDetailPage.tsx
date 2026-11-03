"use client";

import Link from "next/link";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { quantityOf } from "@/features/stock/stock-format";
import type { PreWeighing } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { PageTitle } from "@/components/layout/PageTitle";

export function PreWeighingDetailPage({ preWeighing }: { preWeighing: PreWeighing }) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/pre-weighings" className="flex min-h-8 items-center self-start text-sm underline underline-offset-4">
        Voltar para as pré-pesagens
      </Link>

      <PageTitle>Pré-pesagem de {preWeighing.product.description}</PageTitle>

      <dl role="group" aria-label="Resumo da pré-pesagem" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-4">
          <dt className="text-sm text-muted-foreground">Quantidade a produzir</dt>
          <dd className="text-xl font-semibold">{quantityOf(preWeighing.quantity, preWeighing.product.unit)}</dd>
        </div>
        <div className="rounded-md border p-4">
          <dt className="text-sm text-muted-foreground">Registrada em</dt>
          <dd className="text-xl font-semibold">{formatDateTime(preWeighing.createdAt)}</dd>
        </div>
      </dl>

      <ArrangeableTable
        tableKey="pre-weighing-items"
        rowNoun={{ one: "ingrediente", other: "ingredientes" }}
        rows={preWeighing.items}
        rowKey={(item) => item.product.sku}
        columns={[
          { key: "ingredient", header: "Ingrediente", cell: (item) => item.product.description },
          { key: "planned", header: "Planejado", cell: (item) => quantityOf(item.plannedQuantity, item.product.unit) },
          { key: "weighed", header: "Pesado", cell: (item) => quantityOf(item.weighedQuantity, item.product.unit) },
        ]}
      />
    </div>
  );
}
