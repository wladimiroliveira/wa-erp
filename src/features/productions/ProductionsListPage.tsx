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
import { loadMoreProductions } from "@/features/productions/actions";
import { ProductionStatusBadge } from "@/features/productions/ProductionStatusBadge";
import {
  DEFAULT_STATUS_FILTER,
  FILTER_LABELS,
  readStatusFilter,
  statusOfFilter,
  type StatusFilter,
} from "@/features/productions/status-filter";
import { useUrlSearchParams } from "@/hooks/use-url-search-params";
import type { Production, ProductionPage } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { messageForFailure } from "@/lib/form-errors";
import { withValues } from "@/lib/url-filters";
import { PageTitle } from "@/components/layout/PageTitle";

const FILTERS = Object.keys(FILTER_LABELS) as StatusFilter[];

export function ProductionsListPage({ page, filter }: { page: ProductionPage; filter: StatusFilter }) {
  const { can } = useSession();
  const [searchParams, setSearchParams] = useUrlSearchParams();
  // The pages asked for after the first, which came from the server with the screen.
  const [older, setOlder] = useState<{ items: Production[]; nextCursor: string | null } | null>(null);
  const [loading, startLoading] = useTransition();

  // The same permissions the route of the form asks for: a link there must not land on a refusal.
  const canStart = can("PRODUCTION_CREATE") && can("CATALOG_READ");

  const items = [...page.items, ...(older?.items ?? [])];
  const nextCursor = older === null ? page.nextCursor : older.nextCursor;

  function filterBy(next: StatusFilter): void {
    // A cursor belongs to the list it was read from, so a new filter starts from the first page.
    const params = withValues(
      withValues(searchParams, "cursor", []),
      "status",
      next === DEFAULT_STATUS_FILTER ? [] : [next],
    );

    setSearchParams(params);
  }

  function loadMore(cursor: string): void {
    startLoading(async () => {
      try {
        const result = await loadMoreProductions(statusOfFilter(filter), cursor);

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
      <PageTitle>Produções</PageTitle>

      <div className="flex max-w-xs flex-col gap-2">
        <Label htmlFor="productions-status">Status</Label>
        <NativeSelect
          id="productions-status"
          value={filter}
          onChange={(event) => filterBy(readStatusFilter(event.target.value))}
        >
          {FILTERS.map((value) => (
            <option key={value} value={value}>
              {FILTER_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {items.length === 0 ? (
        <EmptyState
          actions={
            canStart ? (
              <Link href="/productions/new" className={buttonVariants({ variant: "outline" })}>
                Nova produção
              </Link>
            ) : null
          }
        >
          Nenhuma produção encontrada.
        </EmptyState>
      ) : (
        <ArrangeableTable
          tableKey="productions"
          actions={
            canStart ? (
              <IconButton label="Nova produção" variant="default" to="/productions/new">
                <PlusIcon aria-hidden="true" />
              </IconButton>
            ) : null
          }
          rowNoun={{ one: "produção", other: "produções" }}
          fill
          rows={items}
          rowKey={(production) => production.id}
          columns={[
            {
              key: "start",
              header: "Início",
              cell: (production) => (
                <Link
                  href={`/productions/${production.id}`}
                  className="flex min-h-8 items-center underline underline-offset-4"
                >
                  {formatDateTime(production.createdAt)}
                </Link>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (production) => <ProductionStatusBadge status={production.status} />,
            },
            {
              key: "products",
              header: "Produtos",
              cell: (production) => production.items.map((item) => item.product.description).join(", "),
            },
            // Quantities are not added up here: the items of one production may be in different units.
            { key: "items", header: "Itens", cell: (production) => production.items.length },
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
