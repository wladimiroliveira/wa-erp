"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { CancelProductionDialog } from "@/features/productions/CancelProductionDialog";
import { DamageItemDialog } from "@/features/productions/DamageItemDialog";
import { SubstituteItemDialog } from "@/features/productions/SubstituteItemDialog";
import {
  canDamage,
  canSubstitute,
  finishableItems,
  itemsAsTree,
  itemStateLabel,
} from "@/features/productions/item-state";
import { FinishProductionForm } from "@/features/productions/FinishProductionForm";
import { ProductionStatusBadge } from "@/features/productions/ProductionStatusBadge";
import { weighedOf } from "@/features/pre-weighings/weighing-units";
import { moneyOf, NOTHING, quantityOf } from "@/features/stock/stock-format";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import type { LossReason, Production, ProductionItem } from "@/lib/api";
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

interface ItemProps {
  productionId: string;
  productionStatus: Production["status"];
  item: ProductionItem;
  items: ProductionItem[];
  depth: number;
  lossReasons: LossReason[];
  canRecord: boolean;
}

function Item({ productionId, productionStatus, item, items, depth, lossReasons, canRecord }: ItemProps) {
  const headingId = `production-item-${item.id}`;
  const { unit } = item.product;

  return (
    // An item sits under the items that take it, indented one step per level.
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      style={{ marginInlineStart: `${depth * 1.5}rem` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {item.product.description}
        </h2>
        <span className="rounded-md border px-2 py-0.5 text-sm">{itemStateLabel(item, items, productionStatus)}</span>
      </div>

      {canRecord ? (
        <div className="flex flex-wrap gap-2">
          {canDamage(item, items) ? (
            <DamageItemDialog productionId={productionId} item={item} lossReasons={lossReasons} />
          ) : null}
          {canSubstitute(item, items) ? <SubstituteItemDialog productionId={productionId} item={item} /> : null}
          {item.awaitsWeighing ? (
            <Link href={newWeighingHref(productionId, item)} className={buttonVariants({ variant: "outline" })}>
              Nova pesagem
            </Link>
          ) : null}
        </div>
      ) : null}

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
          { key: "quantity", header: "Quantidade", cell: (input) => quantityOf(input.quantity, input.product.unit) },
          // Known only once the production finishes: it is what the lots the input left cost.
          { key: "unitCost", header: "Custo unitário", cell: (input) => moneyOf(input.unitCost) },
          // Only where something was discarded: elsewhere it would be a column of dashes.
          ...(item.inputs.some(({ leftovers }) => leftovers.length > 0)
            ? [{ key: "leftover", header: "Sobra descartada", cell: discardedOf }]
            : []),
        ]}
      />
    </section>
  );
}

type Input = Production["items"][number]["inputs"][number];

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

const newWeighingHref = (productionId: string, item: ProductionItem) =>
  `/pre-weighings/new?${new URLSearchParams({
    productionId,
    itemId: item.id,
    productSku: item.product.sku,
    quantity: item.expectedQuantity,
  })}`;

export function ProductionDetailPage({
  production,
  lossReasons,
}: {
  production: Production;
  lossReasons: LossReason[];
}) {
  const { can } = useSession();
  const canRecord = production.status === "IN_PROGRESS" && can("PRODUCTION_CREATE");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/productions" className="flex min-h-8 items-center text-sm underline underline-offset-4">
          Voltar para as produções
        </Link>

        {/* Supporting facts, out of the way of the items: what the operator works on. */}
        <div role="group" aria-label="Resumo da produção" className="flex flex-wrap items-center justify-end gap-2">
          <ProductionStatusBadge status={production.status} />
          <Badge variant="outline">Iniciada em {formatDateTime(production.createdAt)}</Badge>
          {production.finishedAt !== null ? (
            <Badge variant="outline">Finalizada em {formatDateTime(production.finishedAt)}</Badge>
          ) : null}
          {production.canceledAt !== null ? (
            <Badge variant="outline">Cancelada em {formatDateTime(production.canceledAt)}</Badge>
          ) : null}
        </div>
      </div>

      <PageTitle>Produção de {formatDateTime(production.createdAt)}</PageTitle>

      {itemsAsTree(production.items).map(({ item, depth }) => (
        <Item
          key={item.id}
          productionId={production.id}
          productionStatus={production.status}
          item={item}
          items={production.items}
          depth={depth}
          lossReasons={lossReasons}
          canRecord={canRecord}
        />
      ))}

      {canRecord ? (
        <>
          {/* Nothing ready to finish: the item states already say why, an empty form would only answer 400. */}
          {finishableItems(production.items).length > 0 ? <FinishProductionForm production={production} /> : null}
          <CancelProductionDialog
            productionId={production.id}
            hasFinishedItems={production.items.some(({ status }) => status === "FINISHED")}
          />
        </>
      ) : null}
    </div>
  );
}
