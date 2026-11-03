"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { useSession } from "@/features/auth/use-session";
import { useUrlSearchParams } from "@/hooks/use-url-search-params";
import { dayOf, NOTHING } from "@/features/stock/stock-format";
import { loadStockMovements } from "@/features/stock-movements/actions";
import { movementDirection, movementOrigin } from "@/features/stock-movements/movement-types";
import type { Product, StockMovementPage as MovementPage } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { formatDecimal, formatMoney } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { withValues } from "@/lib/url-filters";
import { unitLabel } from "@/lib/units";
import { PageTitle } from "@/components/layout/PageTitle";

interface StockMovementsPageProps {
  /** The newest page of the history, as the server read it for the product in the address. */
  page: MovementPage;
  /** The catalog to filter by; empty for whoever may not read it. */
  products: Product[];
  productSku: string | undefined;
}

export function StockMovementsPage({ page, products, productSku }: StockMovementsPageProps) {
  const { can } = useSession();
  // The filter lives in the address, so the server reads the first page for it.
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const [filtering, startFiltering] = useTransition();
  // The pages loaded so far: the server's first one, and the older ones asked for after it.
  const [pages, setPages] = useState([page]);
  const [loadingMore, setLoadingMore] = useState(false);

  // A new first page from the server, as after a filter or a refresh, starts the history over.
  useEffect(() => setPages([page]), [page]);

  // The filter is a convenience on top of the history: without the catalog the
  // history still opens, just unfiltered.
  const canFilter = can("CATALOG_READ");

  const items = pages.flatMap((loaded) => loaded.items);
  const nextCursor = pages[pages.length - 1]?.nextCursor ?? null;

  async function loadMore(): Promise<void> {
    if (nextCursor === null) return;

    setLoadingMore(true);

    try {
      const result = await loadStockMovements({ productSku, cursor: nextCursor });

      if (!result.ok) {
        toast.error(messageForFailure(result));
        return;
      }

      setPages((loaded) => [...loaded, result.data]);
    } catch (error) {
      toast.error(messageForFailure(error));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy={filtering}>
      <PageTitle>Movimentações</PageTitle>

      {canFilter ? (
        <div className="flex max-w-md flex-col gap-2">
          <Label htmlFor="movements-product">Produto</Label>
          <NativeSelect
            id="movements-product"
            value={productSku ?? ""}
            onChange={(event) =>
              startFiltering(() =>
                setSearchParams(
                  withValues(searchParams, "productSku", event.target.value === "" ? [] : [event.target.value]),
                ),
              )
            }
          >
            <option value="">Todos os produtos</option>
            {products.map((product) => (
              <option key={product.sku} value={product.sku}>
                {product.description}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      {items.length === 0 ? <p>Nenhuma movimentação encontrada.</p> : null}

      {items.length > 0 ? (
        <ArrangeableTable
          tableKey="stock-movements"
          rowNoun={{ one: "movimentação", other: "movimentações" }}
          fill
          rows={items}
          rowKey={(movement) => movement.id}
          columns={[
            { key: "date", header: "Data", cell: (movement) => formatDateTime(movement.createdAt) },
            { key: "product", header: "Produto", cell: (movement) => movement.product.description },
            {
              key: "lot-expiry",
              header: "Validade do lote",
              cell: (movement) => (movement.lot === null ? NOTHING : dayOf(movement.lot.expiresAt, "Sem validade")),
            },
            {
              key: "direction",
              header: "Tipo",
              cell: (movement) => (
                <Badge variant={movementDirection(movement.type).badge}>{movementDirection(movement.type).label}</Badge>
              ),
            },
            { key: "origin", header: "Origem", cell: (movement) => movementOrigin(movement.type) },
            {
              key: "quantity",
              header: "Quantidade",
              cell: (movement) => (
                <>
                  {movementDirection(movement.type).sign}
                  {formatDecimal(movement.quantity)} {unitLabel(movement.product.unit)}
                </>
              ),
            },
            { key: "unit-cost", header: "Custo unitário", cell: (movement) => formatMoney(movement.unitCost) },
            { key: "author", header: "Lançado por", cell: (movement) => movement.createdBy.name },
          ]}
        />
      ) : null}

      {nextCursor !== null ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}
