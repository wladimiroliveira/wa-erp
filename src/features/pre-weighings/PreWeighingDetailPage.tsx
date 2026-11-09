"use client";

import Link from "next/link";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { weighedOf } from "@/features/pre-weighings/weighing-units";
import { quantityOf } from "@/features/stock/stock-format";
import type { PreWeighing } from "@/lib/api";
import { readableQuantity } from "@/shared/units";
import { formatDateTime } from "@/lib/dates";
import { PageTitle } from "@/components/layout/PageTitle";

type Item = PreWeighing["items"][number];

// Both quantities of an ingredient in the unit its plan reads best in, so they compare at a glance.
const shownOf = ({ product, plannedQuantity }: Item, quantity: string) =>
  weighedOf(quantity, product.unit, readableQuantity(plannedQuantity, product.unit).unit);

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
          { key: "planned", header: "Planejado", cell: (item) => shownOf(item, item.plannedQuantity) },
          { key: "weighed", header: "Pesado", cell: (item) => shownOf(item, item.weighedQuantity) },
        ]}
      />
    </div>
  );
}
