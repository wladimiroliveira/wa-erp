"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { IconButton } from "@/components/common/IconButton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { useSession } from "@/features/auth/use-session";
import { loadMorePreWeighings } from "@/features/pre-weighings/actions";
import { PreWeighingStatusBadge } from "@/features/pre-weighings/PreWeighingStatusBadge";
import {
  PRE_WEIGHING_FILTER_LABELS,
  readPreWeighingFilter,
  statusOfPreWeighingFilter,
  type PreWeighingFilter,
} from "@/features/pre-weighings/status-filter";
import { useUrlSearchParams } from "@/hooks/use-url-search-params";
import { quantityOf } from "@/features/stock/stock-format";
import type { PreWeighing, PreWeighingPage } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { messageForFailure } from "@/lib/form-errors";
import { withValues } from "@/lib/url-filters";
import { PageTitle } from "@/components/layout/PageTitle";

const FILTERS = Object.keys(PRE_WEIGHING_FILTER_LABELS) as PreWeighingFilter[];

interface Props {
  page: PreWeighingPage;
  filter: PreWeighingFilter;
  /** Whether the list keeps only the pending ones older than 2 days. */
  staleOnly: boolean;
  /** How many pending pre-weighings are older than 2 days, whatever the list shows. */
  staleCount: number;
}

export function PreWeighingsListPage({ page, filter, staleOnly, staleCount }: Props) {
  const { can } = useSession();
  const [searchParams, setSearchParams] = useUrlSearchParams();
  // The pages asked for after the first, which came from the server with the screen.
  const [older, setOlder] = useState<{ items: PreWeighing[]; nextCursor: string | null } | null>(null);
  const [loading, startLoading] = useTransition();

  // The same permissions the route of the form asks for: a link there must not land on a refusal.
  const canRecord = can("PRODUCTION_CREATE") && can("CATALOG_READ");

  const items = [...page.items, ...(older?.items ?? [])];
  const nextCursor = older === null ? page.nextCursor : older.nextCursor;

  function filterBy(next: PreWeighingFilter): void {
    // A cursor belongs to the list it was read from, so a new filter starts from the first page.
    const params = withValues(
      withValues(withValues(searchParams, "cursor", []), "staleOnly", []),
      "status",
      next === "all" ? [] : [next],
    );

    setSearchParams(params);
  }

  function loadMore(cursor: string): void {
    startLoading(async () => {
      try {
        const result = await loadMorePreWeighings(cursor, { status: statusOfPreWeighingFilter(filter), staleOnly });

        if (!result.ok) {
          toast.error(messageForFailure(result));
          return;
        }

        setOlder((current) => ({
          items: [...(current?.items ?? []), ...result.data.items],
          nextCursor: result.data.nextCursor,
        }));
      } catch (error) {
        toast.error(messageForFailure(error));
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Pré-pesagens</PageTitle>

      {staleCount > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          <span>
            {staleCount === 1
              ? "1 pré-pesagem pendente há mais de 2 dias"
              : `${staleCount} pré-pesagens pendentes há mais de 2 dias`}
          </span>
          <Link href="/pre-weighings?staleOnly=true" className="underline underline-offset-4">
            Ver
          </Link>
        </div>
      ) : null}

      <div className="flex max-w-xs flex-col gap-2">
        <Label htmlFor="pre-weighings-status">Status</Label>
        <NativeSelect
          id="pre-weighings-status"
          value={filter}
          onChange={(event) => filterBy(readPreWeighingFilter(event.target.value))}
        >
          {FILTERS.map((value) => (
            <option key={value} value={value}>
              {PRE_WEIGHING_FILTER_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {/* The status select cannot show this narrowing, so it is said beside the list. */}
      {staleOnly ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Mostrando pendentes há mais de 2 dias.</span>
          <Link href="/pre-weighings" className="underline underline-offset-4">
            Limpar
          </Link>
        </p>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          actions={
            canRecord ? (
              <Link href="/pre-weighings/new" className={buttonVariants({ variant: "outline" })}>
                Nova pré-pesagem
              </Link>
            ) : null
          }
        >
          Nenhuma pré-pesagem registrada.
        </EmptyState>
      ) : (
        <ArrangeableTable
          tableKey="pre-weighings"
          actions={
            canRecord ? (
              <IconButton label="Nova pré-pesagem" variant="default" to="/pre-weighings/new">
                <PlusIcon aria-hidden="true" />
              </IconButton>
            ) : null
          }
          rowNoun={{ one: "pré-pesagem", other: "pré-pesagens" }}
          fill
          rows={items}
          rowKey={(preWeighing) => preWeighing.id}
          columns={[
            { key: "date", header: "Data", cell: (preWeighing) => formatDateTime(preWeighing.createdAt) },
            {
              key: "status",
              header: "Status",
              cell: (preWeighing) => <PreWeighingStatusBadge status={preWeighing.status} />,
            },
            {
              key: "product",
              header: "Produto",
              cell: (preWeighing) => (
                <Link
                  href={`/pre-weighings/${preWeighing.id}`}
                  className="flex min-h-8 items-center underline underline-offset-4"
                >
                  {preWeighing.product.description}
                </Link>
              ),
            },
            {
              key: "quantity",
              header: "Quantidade a produzir",
              cell: (preWeighing) => quantityOf(preWeighing.quantity, preWeighing.product.unit),
            },
            { key: "ingredients", header: "Ingredientes", cell: (preWeighing) => preWeighing.items.length },
          ]}
        />
      )}

      {nextCursor !== null ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={loading}
          onClick={() => loadMore(nextCursor)}
        >
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}
