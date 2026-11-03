"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { FacetChoice, FacetFilter } from "@/components/common/FacetFilter";
import { useUrlSearchParams } from "@/hooks/use-url-search-params";
import { EmptyState } from "@/components/common/EmptyState";
import { FilterPanel } from "@/components/common/FilterPanel";
import { IconButton } from "@/components/common/IconButton";
import { RowActions, RowActionsItem } from "@/components/common/RowActions";
import { SearchField } from "@/components/common/SearchField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { updateProduct } from "@/features/products/actions";
import { ProductDialog } from "@/features/products/ProductDialog";
import {
  hasProductFilters,
  readProductFilters,
  readStatusChoice,
  STATUS_CHOICES,
  statusLabel,
  withoutProductFilters,
  withStatusChoice,
} from "@/features/products/product-filters";
import { kindLabel, PRODUCT_KINDS } from "@/features/products/product-kinds";
import { RecipeDialog } from "@/features/recipes/RecipeDialog";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import type { Product } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";
import { UNITS, unitLabel, unitName } from "@/lib/units";
import { withValues } from "@/lib/url-filters";
import { PageTitle } from "@/components/layout/PageTitle";

const KIND_OPTIONS = PRODUCT_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) }));
const UNIT_OPTIONS = UNITS.map((unit) => ({ value: unit, label: unitName(unit) }));
const STATUS_OPTIONS = STATUS_CHOICES.map((choice) => ({ value: choice, label: statusLabel(choice) }));

interface ProductsListPageProps {
  /** The products the address's filters answer, as the server read them. */
  products: Product[];
  /** The whole catalog, for the recipe a manufactured product is asked for once registered. */
  catalog: Product[];
}

export function ProductsListPage({ products, catalog }: ProductsListPageProps) {
  const router = useRouter();
  // The address holds the filters in effect; the panel edits a draft of them until Consultar runs it.
  // Running replaces the entry, so the back button leaves the screen rather than undoing a query.
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const [draft, setDraft] = useState(searchParams);
  const drafted = readProductFilters(draft);
  const filtered = hasProductFilters(searchParams);
  // The rows of the last answer stay on screen while the next one loads, instead of a flash of "Carregando…".
  const [loading, startLoading] = useTransition();
  const { can } = useSession();
  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [awaitingRecipe, setAwaitingRecipe] = useState<Product | null>(null);
  const [toggling, setToggling] = useState(false);
  const canCreate = can("CATALOG_CREATE");
  const canEdit = can("CATALOG_UPDATE");

  // A product is never deleted: its movements and recipes still refer to it. Out of use, it only
  // stops being offered where a new record would take it.
  async function toggle(product: Product): Promise<void> {
    setToggling(true);

    try {
      const result = await updateProduct(product.sku, { isActive: !product.isActive });

      if (!result.ok) toast.error(messageForFailure(result));
      else startLoading(() => router.refresh());
    } catch (error) {
      toast.error(messageForFailure(error));
    } finally {
      setToggling(false);
    }
  }

  function openFor(product: Product | null): void {
    setEditing(product);
    setDialogOpen(true);
  }

  // The draft follows the address when it changes from outside, as on a link or the back button.
  useEffect(() => setDraft(searchParams), [searchParams]);

  // Running the filters already in effect reads the list again, so Consultar always brings fresh rows.
  function runQuery(): void {
    startLoading(() => {
      if (draft.toString() === searchParams.toString()) router.refresh();
      else setSearchParams(draft);
    });
  }

  // Clearing runs at once: the plain list is what the screen opens with.
  function clearFilters(): void {
    const cleared = withoutProductFilters(searchParams);

    setDraft(cleared);
    startLoading(() => setSearchParams(cleared));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Produtos</PageTitle>

      <FilterPanel
        label="Filtrar produtos"
        onSubmit={runQuery}
        onClear={filtered || hasProductFilters(draft) ? clearFilters : undefined}
      >
        <SearchField
          label="Buscar produtos"
          placeholder="Buscar por descrição ou GTIN"
          // The draft as typed, untrimmed, so a space between two words survives until the next one.
          value={draft.get("q") ?? ""}
          onChange={(q) => setDraft((params) => withValues(params, "q", [q]))}
        />
        <FacetFilter
          label="Tipo"
          options={KIND_OPTIONS}
          selected={drafted.kind ?? []}
          onChange={(kinds) => setDraft((params) => withValues(params, "kind", kinds))}
        />
        <FacetFilter
          label="Unidade"
          options={UNIT_OPTIONS}
          selected={drafted.unit ?? []}
          onChange={(units) => setDraft((params) => withValues(params, "unit", units))}
        />
        <FacetChoice
          label="Situação"
          options={STATUS_OPTIONS}
          value={readStatusChoice(draft)}
          onChange={(choice) => setDraft((params) => withStatusChoice(params, choice))}
        />
      </FilterPanel>

      {products.length === 0 ? (
        <EmptyState
          actions={
            filtered || canCreate ? (
              <>
                {filtered ? (
                  <Button type="button" variant="outline" onClick={clearFilters}>
                    Limpar filtros
                  </Button>
                ) : null}
                {canCreate ? (
                  <Button type="button" variant="outline" onClick={() => openFor(null)}>
                    Novo produto
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          {filtered ? "Nenhum produto encontrado para estes filtros." : "Nenhum produto ativo."}
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2" aria-busy={loading}>
          <ArrangeableTable
            tableKey="products"
            rowNoun={{ one: "produto", other: "produtos" }}
            fill
            rows={products}
            rowKey={(product) => product.sku}
            actions={
              canCreate ? (
                <IconButton label="Novo produto" variant="default" onClick={() => openFor(null)}>
                  <PlusIcon aria-hidden="true" />
                </IconButton>
              ) : null
            }
            columns={[
              { key: "description", header: "Descrição", cell: (product) => product.description },
              { key: "kind", header: "Tipo", cell: (product) => kindLabel(product.kind) },
              { key: "unit", header: "Unidade", cell: (product) => unitLabel(product.unit) },
              { key: "gtin", header: "GTIN", cell: (product) => product.gtin ?? "—" },
              {
                key: "status",
                header: "Situação",
                cell: (product) => (
                  <Badge variant={product.isActive ? "secondary" : "outline"}>
                    {product.isActive ? "Ativo" : "Inativo"}
                  </Badge>
                ),
              },
              ...(canEdit
                ? [
                    {
                      key: "actions",
                      header: "Ações",
                      cell: (product: Product) => (
                        <RowActions label={`Ações de ${product.description}`}>
                          <RowActionsItem onClick={() => openFor(product)}>Editar</RowActionsItem>
                          <RowActionsItem disabled={toggling} onClick={() => void toggle(product)}>
                            {product.isActive ? "Inativar" : "Reativar"}
                          </RowActionsItem>
                        </RowActions>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}

      <ProductDialog
        product={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(product) => {
          // Only a manufactured product has a recipe, and saving one takes its own permission.
          if (product.kind === "MANUFACTURED" && canEdit) setAwaitingRecipe(product);
        }}
      />

      <RecipeDialog product={awaitingRecipe} catalog={catalog} onClose={() => setAwaitingRecipe(null)} />
    </div>
  );
}
