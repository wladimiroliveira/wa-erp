"use client";

import { useEffect, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { FilterPanel } from "@/components/common/FilterPanel";
import { SearchField } from "@/components/common/SearchField";
import { PageTitle } from "@/components/layout/PageTitle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { useSession } from "@/features/auth/use-session";
import { saveMarkup } from "@/features/pricing/actions";
import {
  filterPricingRows,
  hasPricingFilters,
  readPricingFilters,
  withoutPricingFilters,
} from "@/features/pricing/pricing-filters";
import { costOf } from "@/features/pricing/pricing-format";
import { PricingSheet } from "@/features/pricing/PricingSheet";
import { moneyOf, NOTHING, quantityOf } from "@/features/stock/stock-format";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { useUrlSearchParams } from "@/hooks/use-url-search-params";
import type { PricingRow } from "@/lib/api";
import { formatDecimal, isDecimalInput, toApiDecimal, toDecimalInput } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { unitLabel } from "@/lib/units";
import { withValues } from "@/lib/url-filters";
import { markupPercentSchema } from "@/server/modules/pricing/pricing.schemas";
import { priceFor } from "@/shared/pricing";

const STATUS_LABELS: Record<PricingRow["status"], string | null> = {
  priced: null,
  "no-markup": "Sem markup",
  "incomplete-cost": "Custo incompleto",
};

const INVALID_MARKUP = "Markup entre 0 e 1000, até 2 casas.";

const FAILURE_MESSAGES = {
  403: "Você não tem permissão para editar o markup.",
  404: "Produto não encontrado. A página foi atualizada.",
  409: "Só produto fabricado tem markup.",
};

/** A markup as typed, in the API's form, or `null` when the field does not hold one the server takes. */
function typedMarkup(typed: string): string | null {
  if (!isDecimalInput(typed)) return null;

  const markup = toApiDecimal(typed);

  return markupPercentSchema.safeParse(markup).success ? markup : null;
}

interface PricingPageProps {
  /** Every active manufactured product with a recipe, as the server priced it. */
  rows: PricingRow[];
}

export function PricingPage({ rows }: PricingPageProps) {
  const router = useRouter();
  const { can } = useSession();
  const editable = can("PRICING_UPDATE");
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const [draft, setDraft] = useState(searchParams);
  const filtered = hasPricingFilters(searchParams);
  const [loading, startLoading] = useTransition();
  // What is typed in each markup field that differs from what is saved, by product.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [opened, setOpened] = useState<PricingRow | null>(null);
  // The products whose markup is on its way to the server: their field waits, so one save goes at a time.
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => setDraft(searchParams), [searchParams]);

  function runQuery(): void {
    startLoading(() => {
      if (draft.toString() !== searchParams.toString()) setSearchParams(draft);
      else router.refresh();
    });
  }

  function clearFilters(): void {
    const cleared = withoutPricingFilters(searchParams);

    setDraft(cleared);
    setSearchParams(cleared);
  }

  function discard(sku: string): void {
    setTyped((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== sku)));
  }

  async function save(row: PricingRow): Promise<void> {
    const sku = row.product.sku;
    const markup = typedMarkup(typed[sku] ?? "");

    if (markup === null || saving.has(sku)) return;

    setSaving((current) => new Set(current).add(sku));
    const result = await saveMarkup({ productSku: sku, markupPercent: markup });
    setSaving((current) => {
      const next = new Set(current);
      next.delete(sku);
      return next;
    });

    // Saved, the page comes back from the server with the new markup; refused, the old one stands.
    if (result.ok) toast.success("Markup salvo.");
    else toast.error(messageForFailure(result, FAILURE_MESSAGES));
    discard(sku);
  }

  function onMarkupKey(event: KeyboardEvent<HTMLInputElement>, row: PricingRow): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void save(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      discard(row.product.sku);
    }
  }

  const shown = filterPricingRows(rows, readPricingFilters(searchParams));

  function markupCell(row: PricingRow) {
    const saved = row.markupPercent === null ? "" : toDecimalInput(row.markupPercent);

    if (!editable) return row.markupPercent === null ? NOTHING : `${formatDecimal(row.markupPercent, 2)} %`;

    const sku = row.product.sku;
    const value = typed[sku] ?? saved;
    const invalid = sku in typed && typedMarkup(value) === null;

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <NumericInput
            aria-label={`Markup de ${row.product.description}`}
            aria-invalid={invalid}
            disabled={saving.has(sku)}
            className="w-28"
            trailing="%"
            minFractionDigits={2}
            value={value}
            onChange={(event) => setTyped((current) => ({ ...current, [sku]: event.target.value }))}
            onKeyDown={(event) => onMarkupKey(event, row)}
          />
          {sku in typed && value !== saved ? (
            <Button type="button" size="sm" disabled={invalid || saving.has(sku)} onClick={() => void save(row)}>
              Salvar
            </Button>
          ) : null}
        </div>
        {invalid ? <p className="text-sm text-destructive">{INVALID_MARKUP}</p> : null}
      </div>
    );
  }

  function priceCell(row: PricingRow): string {
    const sku = row.product.sku;

    if (!(sku in typed)) return moneyOf(row.pricePerUnit);

    const markup = typedMarkup(typed[sku] ?? "");

    return row.costPerUnit === null || markup === null ? NOTHING : moneyOf(priceFor(row.costPerUnit, markup));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Precificação</PageTitle>

      <FilterPanel
        label="Filtrar produtos"
        onSubmit={runQuery}
        onClear={filtered || hasPricingFilters(draft) ? clearFilters : undefined}
      >
        <SearchField
          label="Buscar produtos"
          placeholder="Buscar por descrição"
          value={draft.get("q") ?? ""}
          onChange={(q) => setDraft((params) => withValues(params, "q", [q]))}
        />
      </FilterPanel>

      {shown.length === 0 ? (
        <EmptyState
          actions={
            filtered ? (
              <Button type="button" variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : null
          }
        >
          {filtered ? "Nenhum produto encontrado para estes filtros." : "Nenhum produto fabricado com receita."}
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2" aria-busy={loading}>
          <ArrangeableTable
            tableKey="pricing"
            rowNoun={{ one: "produto", other: "produtos" }}
            fill
            rows={shown}
            rowKey={(row) => row.product.sku}
            columns={[
              {
                key: "product",
                header: "Produto",
                cell: (row) => (
                  <button
                    type="button"
                    className="text-left underline-offset-4 hover:underline"
                    onClick={() => setOpened(row)}
                  >
                    {row.product.description}
                  </button>
                ),
              },
              { key: "unit", header: "Unidade", cell: (row) => unitLabel(row.product.unit) },
              { key: "yield", header: "Rendimento", cell: (row) => quantityOf(row.yieldQuantity, row.product.unit) },
              { key: "cost", header: "Custo/un", cell: (row) => costOf(row.costPerUnit) },
              { key: "markup", header: "Markup", cell: markupCell },
              { key: "price", header: "Preço/un", cell: priceCell },
              {
                key: "status",
                header: "Situação",
                cell: (row) => {
                  const label = STATUS_LABELS[row.status];

                  return label === null ? null : (
                    <Badge variant={row.status === "incomplete-cost" ? "destructive" : "outline"}>{label}</Badge>
                  );
                },
              },
            ]}
          />
        </div>
      )}

      <PricingSheet row={opened} onClose={() => setOpened(null)} />
    </div>
  );
}
