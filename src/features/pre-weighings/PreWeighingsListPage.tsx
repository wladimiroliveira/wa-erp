"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { IconButton } from "@/components/common/IconButton";
import { Button, buttonVariants } from "@/components/ui/button";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { useSession } from "@/features/auth/use-session";
import { loadMorePreWeighings } from "@/features/pre-weighings/actions";
import { quantityOf } from "@/features/stock/stock-format";
import type { PreWeighing, PreWeighingPage } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { messageForFailure } from "@/lib/form-errors";
import { PageTitle } from "@/components/layout/PageTitle";

export function PreWeighingsListPage({ page }: { page: PreWeighingPage }) {
  const { can } = useSession();
  // The pages asked for after the first, which came from the server with the screen.
  const [older, setOlder] = useState<{ items: PreWeighing[]; nextCursor: string | null } | null>(null);
  const [loading, startLoading] = useTransition();

  // The same permissions the route of the form asks for: a link there must not land on a refusal.
  const canRecord = can("PRODUCTION_CREATE") && can("CATALOG_READ");

  const items = [...page.items, ...(older?.items ?? [])];
  const nextCursor = older === null ? page.nextCursor : older.nextCursor;

  function loadMore(cursor: string): void {
    startLoading(async () => {
      try {
        const result = await loadMorePreWeighings(cursor);

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
