"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { useUrlSearchParams } from "@/hooks/use-url-search-params";
import { FacetChoice } from "@/components/common/FacetFilter";
import { FilterPanel } from "@/components/common/FilterPanel";
import { IconButton } from "@/components/common/IconButton";
import { RowActions, RowActionsItem } from "@/components/common/RowActions";
import { SearchField } from "@/components/common/SearchField";
import { PageTitle } from "@/components/layout/PageTitle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  filterRecipeRows,
  hasRecipeFilters,
  RECIPE_CHOICES,
  recipeChoiceLabel,
  readRecipeFilters,
  type RecipeRow,
  withoutRecipeFilters,
  withRecipeChoice,
} from "@/features/recipes/recipe-filters";
import { NewRecipeDialog } from "@/features/recipes/NewRecipeDialog";
import { RecipeSheet, type RecipeSheetTarget } from "@/features/recipes/RecipeSheet";
import { NOTHING, quantityOf } from "@/features/stock/stock-format";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import type { Product, RecipeSummary } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { unitLabel } from "@/lib/units";
import { withValues } from "@/lib/url-filters";

const RECIPE_OPTIONS = RECIPE_CHOICES.map((choice) => ({ value: choice, label: recipeChoiceLabel(choice) }));

interface RecipesListPageProps {
  /** The whole catalog, as the server read it. */
  products: Product[];
  /** One line per recipe there is: a product missing from it has none. */
  summaries: RecipeSummary[];
}

export function RecipesListPage({ products, summaries }: RecipesListPageProps) {
  const router = useRouter();
  // The address holds the filters in effect; the panel edits a draft of them until Consultar runs it.
  const [searchParams, setSearchParams] = useUrlSearchParams();
  const [draft, setDraft] = useState(searchParams);
  const filters = readRecipeFilters(searchParams);
  const filtered = hasRecipeFilters(searchParams);
  const [loading, startLoading] = useTransition();
  const [opened, setOpened] = useState<RecipeSheetTarget | null>(null);
  const [choosing, setChoosing] = useState(false);

  // The draft follows the address when it changes from outside, as on a link or the back button.
  useEffect(() => setDraft(searchParams), [searchParams]);

  // Running the filters already in effect reads both lists again, so Consultar always brings fresh rows.
  function runQuery(): void {
    startLoading(() => {
      if (draft.toString() !== searchParams.toString()) setSearchParams(draft);
      else router.refresh();
    });
  }

  function clearFilters(): void {
    const cleared = withoutRecipeFilters(searchParams);

    setDraft(cleared);
    setSearchParams(cleared);
  }

  // Only a manufactured product has a recipe, and an inactive one is refused by the server.
  const byProduct = new Map(summaries.map((summary) => [summary.product.sku, summary]));
  const rows: RecipeRow[] = products
    .filter((product) => product.isActive && product.kind === "MANUFACTURED")
    .map((product) => ({ product, summary: byProduct.get(product.sku) }));
  const shown = filterRecipeRows(rows, filters);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Receitas</PageTitle>

      <FilterPanel
        label="Filtrar receitas"
        onSubmit={runQuery}
        onClear={filtered || hasRecipeFilters(draft) ? clearFilters : undefined}
      >
        <SearchField
          label="Buscar produtos"
          placeholder="Buscar por descrição"
          value={draft.get("q") ?? ""}
          onChange={(q) => setDraft((params) => withValues(params, "q", [q]))}
        />
        <FacetChoice
          label="Receita"
          options={RECIPE_OPTIONS}
          value={readRecipeFilters(draft).recipe}
          onChange={(choice) => setDraft((params) => withRecipeChoice(params, choice))}
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
          {filtered ? "Nenhum produto encontrado para estes filtros." : "Nenhum produto fabricado ativo cadastrado."}
        </EmptyState>
      ) : null}

      {shown.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2" aria-busy={loading}>
          <ArrangeableTable
            tableKey="recipes"
            rowNoun={{ one: "produto", other: "produtos" }}
            fill
            rows={shown}
            rowKey={({ product }) => product.sku}
            actions={
              <IconButton label="Nova receita" variant="default" onClick={() => setChoosing(true)}>
                <PlusIcon aria-hidden="true" />
              </IconButton>
            }
            columns={[
              {
                key: "product",
                header: "Produto",
                cell: ({ product }) => (
                  <button
                    type="button"
                    className="text-left underline-offset-4 hover:underline"
                    onClick={() => setOpened({ product, mode: "view" })}
                  >
                    {product.description}
                  </button>
                ),
              },
              { key: "unit", header: "Unidade", cell: ({ product }) => unitLabel(product.unit) },
              {
                key: "recipe",
                header: "Receita",
                cell: ({ summary }) => (
                  <Badge variant={summary === undefined ? "outline" : "secondary"}>
                    {recipeChoiceLabel(summary === undefined ? "WITHOUT" : "WITH")}
                  </Badge>
                ),
              },
              {
                key: "yield",
                header: "Rendimento",
                cell: ({ product, summary }) =>
                  summary === undefined ? NOTHING : quantityOf(summary.yieldQuantity, product.unit),
              },
              {
                key: "ingredients",
                header: "Ingredientes",
                cell: ({ summary }) => summary?.ingredientCount ?? NOTHING,
              },
              {
                key: "updatedAt",
                header: "Atualizada em",
                cell: ({ summary }) => (summary === undefined ? NOTHING : formatDateTime(summary.updatedAt)),
              },
              {
                key: "actions",
                header: "Ações",
                cell: ({ product, summary }) => (
                  <RowActions label={`Ações de ${product.description}`}>
                    {summary === undefined ? null : (
                      <RowActionsItem onClick={() => setOpened({ product, mode: "view" })}>Ver receita</RowActionsItem>
                    )}
                    <RowActionsItem onClick={() => setOpened({ product, mode: "edit" })}>
                      {summary === undefined ? "Criar receita" : "Editar receita"}
                    </RowActionsItem>
                  </RowActions>
                ),
              },
            ]}
          />
        </div>
      ) : null}

      <NewRecipeDialog
        open={choosing}
        candidates={rows.filter(({ summary }) => summary === undefined).map(({ product }) => product)}
        onClose={() => setChoosing(false)}
        onChoose={(product) => {
          setChoosing(false);
          setOpened({ product, mode: "edit" });
        }}
      />

      <RecipeSheet target={opened} catalog={products} onClose={() => setOpened(null)} />
    </div>
  );
}
