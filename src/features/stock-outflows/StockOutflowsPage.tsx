"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { PageTitle } from "@/components/layout/PageTitle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useSession } from "@/features/auth/use-session";
import { loadOutflows } from "@/features/stock-outflows/actions";
import { OutflowDialog } from "@/features/stock-outflows/OutflowDialog";
import { moneyOf, quantityOf } from "@/features/stock/stock-format";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { useUrlSearchParams } from "@/hooks/use-url-search-params";
import type { Outflow, OutflowPage, OutflowSummary, Product } from "@/lib/api";
import { formatDateOf } from "@/lib/dates";
import { messageForFailure } from "@/lib/form-errors";
import { OUTFLOW_PAGE_SIZE } from "@/shared/outflows";
import { withValues } from "@/lib/url-filters";

interface StockOutflowsPageProps {
  /** The newest page of the period, as the server read it for the address. */
  page: OutflowPage;
  summary: OutflowSummary;
  /** The products to filter by and to record an outflow for. */
  products: Product[];
  from: string;
  to: string;
  productSku: string | undefined;
}

/** What a row brought in or lost: the profit of a sale, the cost of a donation as a loss. */
function resultOf(outflow: Outflow): string {
  return outflow.profit !== null ? moneyOf(outflow.profit) : moneyOf(`-${outflow.cost}`);
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-sm text-muted-foreground">{title}</span>
      <span className="text-xl font-semibold">{value}</span>
    </div>
  );
}

export function StockOutflowsPage({ page, summary, products, from, to, productSku }: StockOutflowsPageProps) {
  const { can } = useSession();
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const [filtering, startFiltering] = useTransition();
  const [pages, setPages] = useState([page]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [recording, setRecording] = useState(false);

  // A new first page from the server, as after a filter or a recorded outflow, starts the list over.
  useEffect(() => setPages([page]), [page]);

  const items = pages.flatMap((loaded) => loaded.items);
  const nextCursor = pages[pages.length - 1]?.nextCursor ?? null;

  function filterBy(key: string, values: string[]): void {
    startFiltering(() => setSearchParams(withValues(searchParams, key, values)));
  }

  // A date field holds nothing while it is half typed: only a whole day moves the period.
  const changePeriod = (key: "from" | "to") => (value: string) => {
    if (value !== "") filterBy(key, [value]);
  };

  async function loadMore(): Promise<void> {
    if (nextCursor === null) return;

    setLoadingMore(true);

    try {
      const result = await loadOutflows({ from, to, productSku, cursor: nextCursor, limit: OUTFLOW_PAGE_SIZE });

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
      <div className="flex items-center justify-between gap-2">
        <PageTitle>Saídas</PageTitle>
        {can("SALES_CREATE") ? (
          <Button type="button" onClick={() => setRecording(true)}>
            Nova saída
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="outflows-from">De</Label>
          <Input
            id="outflows-from"
            type="date"
            key={from}
            defaultValue={from}
            max={to}
            onChange={(event) => changePeriod("from")(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="outflows-to">Até</Label>
          <Input
            id="outflows-to"
            type="date"
            key={to}
            defaultValue={to}
            min={from}
            onChange={(event) => changePeriod("to")(event.target.value)}
          />
        </div>
        <div className="flex min-w-48 flex-col gap-2">
          <Label htmlFor="outflows-product">Produto</Label>
          <NativeSelect
            id="outflows-product"
            value={productSku ?? ""}
            onChange={(event) => filterBy("productSku", event.target.value === "" ? [] : [event.target.value])}
          >
            <option value="">Todos os produtos</option>
            {products.map((product) => (
              <option key={product.sku} value={product.sku}>
                {product.description}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card title="Vendido" value={moneyOf(summary.revenue)} />
        <Card title="Lucro das vendas" value={moneyOf(summary.profit)} />
        <Card title="Doado (a custo)" value={moneyOf(summary.donated)} />
        <Card title="Resultado" value={moneyOf(summary.result)} />
      </div>

      {items.length === 0 ? <p>Nenhuma saída no período.</p> : null}

      {items.length > 0 ? (
        <ArrangeableTable
          tableKey="stock-outflows"
          rowNoun={{ one: "saída", other: "saídas" }}
          fill
          rows={items}
          rowKey={(outflow) => outflow.id}
          columns={[
            { key: "date", header: "Data", cell: (outflow) => formatDateOf(outflow.createdAt) },
            {
              key: "kind",
              header: "Tipo",
              cell: (outflow) => (
                <Badge variant={outflow.kind === "SALE" ? "default" : "secondary"}>
                  {outflow.kind === "SALE" ? "Venda" : "Doação"}
                </Badge>
              ),
            },
            { key: "product", header: "Produto", cell: (outflow) => outflow.product.description },
            {
              key: "quantity",
              header: "Quantidade",
              cell: (outflow) => quantityOf(outflow.quantity, outflow.product.unit),
            },
            { key: "price", header: "Preço", cell: (outflow) => moneyOf(outflow.unitPrice) },
            { key: "revenue", header: "Receita", cell: (outflow) => moneyOf(outflow.revenue) },
            { key: "cost", header: "Custo", cell: (outflow) => moneyOf(outflow.cost) },
            { key: "result", header: "Lucro/prejuízo", cell: resultOf },
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

      {can("SALES_CREATE") ? <OutflowDialog open={recording} products={products} onOpenChange={setRecording} /> : null}
    </div>
  );
}
