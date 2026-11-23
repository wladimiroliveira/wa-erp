"use client";

import Link from "next/link";
import { useSession } from "@/features/auth/use-session";
import { DeletePreWeighingDialog } from "@/features/pre-weighings/DeletePreWeighingDialog";
import { PreWeighingStatusBadge } from "@/features/pre-weighings/PreWeighingStatusBadge";
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
  const { can } = useSession();
  // One a production is using goes when that production is canceled, or stays as its record.
  const canDelete = preWeighing.status === "PENDING" && can("PRODUCTION_CREATE");

  return (
    <div className="flex flex-col gap-4">
      <Link href="/pre-weighings" className="flex min-h-8 items-center self-start text-sm underline underline-offset-4">
        Voltar para as pré-pesagens
      </Link>

      <PageTitle>Pré-pesagem de {preWeighing.product.description}</PageTitle>

      <div className="self-start">
        <PreWeighingStatusBadge status={preWeighing.status} />
      </div>

      {preWeighing.parent === null ? null : (
        <Link
          href={`/pre-weighings/${preWeighing.parent.id}`}
          className="flex min-h-8 items-center self-start text-sm underline underline-offset-4"
        >
          Para: {preWeighing.parent.product.description}
        </Link>
      )}

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

      {preWeighing.children.length === 0 ? null : (
        <section aria-labelledby="pre-weighing-children" className="flex flex-col gap-2">
          <h2 id="pre-weighing-children" className="text-lg font-semibold">
            Intermediários
          </h2>
          <ul className="flex flex-col gap-1">
            {preWeighing.children.map((child) => (
              <li key={child.id}>
                <Link href={`/pre-weighings/${child.id}`} className="underline underline-offset-4">
                  {child.product.description} — {quantityOf(child.quantity, child.product.unit)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ArrangeableTable
        tableKey="pre-weighing-items"
        rowNoun={{ one: "ingrediente", other: "ingredientes" }}
        rows={preWeighing.items}
        rowKey={(item) => item.product.sku}
        columns={[
          { key: "ingredient", header: "Ingrediente", cell: (item) => item.product.description },
          { key: "planned", header: "Planejado", cell: (item) => shownOf(item, item.plannedQuantity) },
          {
            key: "weighed",
            header: "Pesado",
            cell: (item) => (item.weighedQuantity === null ? "do estoque" : shownOf(item, item.weighedQuantity)),
          },
        ]}
      />

      {canDelete ? (
        <DeletePreWeighingDialog preWeighingId={preWeighing.id} withStages={preWeighing.children.length > 0} />
      ) : null}
    </div>
  );
}
