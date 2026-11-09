"use client";

import Link from "next/link";
import { useSession } from "@/features/auth/use-session";
import { CancelProductionDialog } from "@/features/productions/CancelProductionDialog";
import { FinishProductionForm } from "@/features/productions/FinishProductionForm";
import { ProductionStatusBadge } from "@/features/productions/ProductionStatusBadge";
import { weighedOf } from "@/features/pre-weighings/weighing-units";
import { moneyOf, NOTHING, quantityOf } from "@/features/stock/stock-format";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import type { Production, ProductionItem } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/decimal";
import { divideHalfUp, fromScaled, scale, toScaled } from "@/shared/fixed-point";
import { normalizeDecimal, readableQuantity } from "@/shared/units";
import { PageTitle } from "@/components/layout/PageTitle";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold">{children}</dd>
    </div>
  );
}

function Item({ item }: { item: ProductionItem }) {
  const headingId = `production-item-${item.id}`;
  const { unit } = item.product;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {item.product.description}
      </h2>

      <dl className="grid gap-3 sm:grid-cols-4">
        <Fact label="Origem">
          {item.preWeighingId !== null ? (
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
      </dl>

      <ArrangeableTable
        tableKey="production-item-inputs"
        rowNoun={{ one: "insumo", other: "insumos" }}
        rows={item.inputs}
        rowKey={(input) => input.product.sku}
        columns={[
          { key: "input", header: "Insumo", cell: (input) => input.product.description },
          { key: "quantity", header: "Quantidade", cell: (input) => quantityOf(input.quantity, input.product.unit) },
          // Known only once the production finishes: it is what the lots the input left cost.
          { key: "unitCost", header: "Custo unitário", cell: (input) => moneyOf(input.unitCost) },
          { key: "leftover", header: "Sobra descartada", cell: discardedOf },
        ]}
      />
    </section>
  );
}

type Input = Production["items"][number]["inputs"][number];

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

export function ProductionDetailPage({ production }: { production: Production }) {
  const { can } = useSession();
  const canRecord = production.status === "IN_PROGRESS" && can("PRODUCTION_CREATE");

  return (
    <div className="flex flex-col gap-6">
      <Link href="/productions" className="flex min-h-8 items-center self-start text-sm underline underline-offset-4">
        Voltar para as produções
      </Link>

      <PageTitle>Produção de {formatDateTime(production.createdAt)}</PageTitle>

      <dl role="group" aria-label="Resumo da produção" className="grid gap-3 sm:grid-cols-3">
        <Fact label="Status">
          <ProductionStatusBadge status={production.status} />
        </Fact>
        <Fact label="Iniciada em">{formatDateTime(production.createdAt)}</Fact>
        {production.hasLeftoversInCost === null ? null : (
          <Fact label="Sobras no custo">{production.hasLeftoversInCost ? "Sim" : "Não"}</Fact>
        )}
        {production.finishedAt !== null ? (
          <Fact label="Finalizada em">{formatDateTime(production.finishedAt)}</Fact>
        ) : null}
        {production.canceledAt !== null ? (
          <Fact label="Cancelada em">{formatDateTime(production.canceledAt)}</Fact>
        ) : null}
      </dl>

      {production.items.map((item) => (
        <Item key={item.id} item={item} />
      ))}

      {canRecord ? (
        <>
          <FinishProductionForm production={production} />
          <CancelProductionDialog productionId={production.id} />
        </>
      ) : null}
    </div>
  );
}
