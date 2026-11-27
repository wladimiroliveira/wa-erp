"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { CancelProductionDialog } from "@/features/productions/CancelProductionDialog";
import { DamageItemDialog } from "@/features/productions/DamageItemDialog";
import { SubstituteItemDialog } from "@/features/productions/SubstituteItemDialog";
import { BatchesSection } from "@/features/productions/BatchesSection";
import { ConcludeItemForm } from "@/features/productions/ConcludeItemForm";
import { canDamage, canSubstitute } from "@/features/productions/item-state";
import { ItemWeighingPanel } from "@/features/productions/ItemWeighingPanel";
import { ItemDetailsSheet } from "@/features/productions/ItemDetailsSheet";
import { ProductionStatusBadge } from "@/features/productions/ProductionStatusBadge";
import { timelineOf, type TimelineEvent, type WaitingItem } from "@/features/productions/timeline";
import { quantityOf } from "@/features/stock/stock-format";
import type { LossReason, Production, ProductionItem } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { PageAside, PageTitle } from "@/components/layout/PageTitle";

/** How many of the latest events show before the operator asks for all of them. */
const COLLAPSED_EVENTS = 3;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Done({ events, expanded }: { events: TimelineEvent[]; expanded: boolean }) {
  const [showAll, setShowAll] = useState(false);
  // Read on every render: a refresh that closes the production expands the list it finds collapsed.
  const shown = expanded || showAll ? events : events.slice(-COLLAPSED_EVENTS);

  return (
    <Section title="Feito">
      <ol className="flex flex-col gap-1 text-sm text-muted-foreground">
        {shown.map((event, index) => (
          <li key={`${event.at}-${event.text}-${index}`} className="flex min-h-8 items-center gap-3">
            {event.at !== null ? (
              <time dateTime={event.at} className="w-32 shrink-0 tabular-nums">
                {formatDateTime(event.at)}
              </time>
            ) : (
              <span className="w-32 shrink-0" />
            )}
            {/* Only the line that closes an item's story keeps its receipt: its facts, inputs and costs stay
                reachable from there once it has left Agora. */}
            {event.ends && event.item !== null ? <ItemDetailsSheet item={event.item} /> : null}
            <span>{event.text}</span>
          </li>
        ))}
      </ol>
      {shown.length < events.length ? (
        <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setShowAll(true)}>
          {`Ver tudo (${events.length})`}
        </Button>
      ) : null}
    </Section>
  );
}

interface StageCardProps {
  production: Production;
  item: ProductionItem;
  lossReasons: LossReason[];
  canRecord: boolean;
}

function StageCard({ production, item, lossReasons, canRecord }: StageCardProps) {
  const headingId = useId();
  const showDamage = canRecord && canDamage(item, production.items);
  const showSubstitute = canRecord && canSubstitute(item, production.items);

  return (
    <section
      aria-labelledby={headingId}
      // Narrow, so the fields and buttons inside it keep the width of what they hold.
      className="flex w-full max-w-xl flex-col gap-4 rounded-lg border border-primary/40 bg-primary/5 p-4"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ItemDetailsSheet item={item} />
          <h3 id={headingId} className="text-xl font-semibold">
            {item.product.description}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          <span>{`Previsto ${quantityOf(item.expectedQuantity, item.product.unit)}`}</span>
          {/* An item awaiting a weighing has lost its origin to the damage: it has none until weighed again. */}
          {item.awaitsWeighing ? null : (
            <>
              {" · "}
              {item.preWeighingId !== null ? (
                <Link href={`/pre-weighings/${item.preWeighingId}`} className="underline underline-offset-4">
                  da pré-pesagem
                </Link>
              ) : (
                <span>da receita</span>
              )}
            </>
          )}
        </p>
      </div>

      {item.awaitsWeighing ? (
        <div className="flex flex-col gap-3">
          {/* A damage that took its pre-weighing is why it waits; an item added for a shortage just has none yet. */}
          {item.damages.some((damage) => damage.preWeighingId !== null) ? (
            <p className="text-sm font-medium text-destructive">
              {canRecord ? "Avariado — faça uma nova pesagem" : "Avariado — aguardando nova pesagem"}
            </p>
          ) : (
            <p className="text-sm font-medium">Aguardando pesagem</p>
          )}
          {/* Weighed here, open: it is what the item waits for. */}
          {canRecord ? (
            <ItemWeighingPanel key={`${production.id}-${item.id}`} production={production} item={item} />
          ) : null}
        </div>
      ) : (
        <>
          <BatchesSection production={production} item={item} canRecord={canRecord} />
          {canRecord ? (
            <ConcludeItemForm key={`${production.id}-${item.id}`} production={production} item={item} />
          ) : null}
        </>
      )}

      {showDamage || showSubstitute ? (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {showDamage ? <DamageItemDialog productionId={production.id} item={item} lossReasons={lossReasons} /> : null}
          {showSubstitute ? <SubstituteItemDialog productionId={production.id} item={item} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function Next({
  production,
  waiting,
  canRecord,
}: {
  production: Production;
  waiting: WaitingItem[];
  canRecord: boolean;
}) {
  return (
    <Section title="Depois">
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {waiting.map(({ item, waitsFor, notProduced }) => {
          const name = item.product.description;

          return (
            <li key={item.id} className="flex min-h-8 items-center gap-3">
              <ItemDetailsSheet item={item} />
              <span>{notProduced ? `${name} · Não produzido` : `${name} · aguardando ${waitsFor.join(", ")}`}</span>
              {canRecord && canSubstitute(item, production.items) ? (
                <SubstituteItemDialog productionId={production.id} item={item} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function ProductionDetailPage({
  production,
  lossReasons,
}: {
  production: Production;
  lossReasons: LossReason[];
}) {
  const { can } = useSession();
  const canRecord = production.status === "IN_PROGRESS" && can("PRODUCTION_CREATE");
  const { done, now, next } = timelineOf(production);

  return (
    <div className="flex flex-col gap-8">
      <PageAside>
        {/* Supporting facts, out of the way of the items: what the operator works on. */}
        <div role="group" aria-label="Resumo da produção" className="flex items-center gap-2">
          <ProductionStatusBadge status={production.status} />
          <Badge variant="outline">Iniciada em {formatDateTime(production.createdAt)}</Badge>
          {production.finishedAt !== null ? (
            <Badge variant="outline">Finalizada em {formatDateTime(production.finishedAt)}</Badge>
          ) : null}
          {production.canceledAt !== null ? (
            <Badge variant="outline">Cancelada em {formatDateTime(production.canceledAt)}</Badge>
          ) : null}
        </div>
      </PageAside>

      <PageTitle crumb={`Produção de ${formatDateTime(production.createdAt)}`}>Produção</PageTitle>

      {/* A closed production is a record: all of it shows. */}
      <Done events={done} expanded={production.status !== "IN_PROGRESS"} />

      {production.status === "IN_PROGRESS" && now.length > 0 ? (
        <Section title="Agora">
          {/* Keyed by production and item: a refresh keeps what was typed in a card still here. */}
          {now.map((item) => (
            <StageCard
              key={`${production.id}-${item.id}`}
              production={production}
              item={item}
              lossReasons={lossReasons}
              canRecord={canRecord}
            />
          ))}
        </Section>
      ) : null}

      {next.length > 0 ? <Next production={production} waiting={next} canRecord={canRecord} /> : null}

      {canRecord ? (
        <CancelProductionDialog
          productionId={production.id}
          hasFinishedItems={production.items.some(({ status }) => status === "FINISHED")}
          concludesBatches={production.items.some(({ status, batches }) => status === "PENDING" && batches.length > 0)}
          releasesPreWeighings={production.items.some(
            ({ status, batches }) => status === "PENDING" && batches.length === 0,
          )}
        />
      ) : null}
    </div>
  );
}
