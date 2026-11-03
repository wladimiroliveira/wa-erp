"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RecipeForm, recipeTitle } from "@/features/recipes/RecipeForm";
import { RecipeView } from "@/features/recipes/RecipeView";
import { readRecipe } from "@/features/recipes/actions";
import type { Product, Recipe } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";

export interface RecipeSheetTarget {
  product: Product;
  /** How the sheet opens: on the recipe to read, or straight into its form. */
  mode: "view" | "edit";
}

interface RecipeSheetProps {
  /** The recipe to show, or `null` while there is none. */
  target: RecipeSheetTarget | null;
  /** The products an ingredient is chosen from. */
  catalog: Product[];
  onClose: () => void;
}

/** The recipe of one product beside the list: read first, and turned into a form only on request. */
export function RecipeSheet({ target, catalog, onClose }: RecipeSheetProps) {
  // Each opening starts over, in the mode it asked for and with nothing typed.
  return target === null ? null : (
    <OpenRecipeSheet key={`${target.product.sku}:${target.mode}`} {...target} catalog={catalog} onClose={onClose} />
  );
}

/** What the operator was doing when they asked to leave a form with changes in it. */
type Leaving = "cancel" | "close";

function OpenRecipeSheet({
  product,
  mode: initialMode,
  catalog,
  onClose,
}: RecipeSheetTarget & Omit<RecipeSheetProps, "target">) {
  const [mode, setMode] = useState(initialMode);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<Leaving | null>(null);

  // A recipe is read anew each time the sheet opens, and never reread behind the operator, which
  // would throw away the rows they are typing into.
  const recipe = useRecipeOf(product.sku);

  function read(): void {
    setDirty(false);
    setMode("view");
  }

  function leave(how: Leaving): void {
    if (mode === "edit" && dirty) setLeaving(how);
    else if (how === "close") onClose();
    else read();
  }

  function discard(): void {
    const how = leaving;

    setLeaving(null);
    if (how === "close") onClose();
    else read();
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : leave("close"))}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-lg font-semibold">
            {recipeTitle(product, recipe.status === "loaded" ? recipe.data : null)}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          {recipe.status === "loading" ? <p>Carregando a receita…</p> : null}

          {recipe.status === "failed" ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p>{recipe.message}</p>
              <Button type="button" variant="outline" onClick={recipe.retry}>
                Tentar de novo
              </Button>
            </div>
          ) : null}

          {recipe.status === "loaded" && mode === "view" && recipe.data === null ? (
            <div className="flex flex-col items-start gap-3">
              <p>{product.description} ainda não tem receita.</p>
              <Button type="button" onClick={() => setMode("edit")}>
                Criar receita
              </Button>
            </div>
          ) : null}

          {recipe.status === "loaded" && mode === "view" && recipe.data !== null ? (
            <>
              <RecipeView recipe={recipe.data} />
              <Button type="button" className="self-start" onClick={() => setMode("edit")}>
                Editar receita
              </Button>
            </>
          ) : null}

          {recipe.status === "loaded" && mode === "edit" ? (
            <RecipeForm
              product={product}
              recipe={recipe.data}
              catalog={catalog}
              onSaved={(saved) => {
                recipe.replace(saved);
                read();
              }}
              onDirtyChange={setDirty}
              secondaryAction={
                <Button type="button" variant="outline" onClick={() => leave("cancel")}>
                  Cancelar
                </Button>
              }
            />
          ) : null}
        </div>
      </SheetContent>

      <AlertDialog open={leaving !== null} onOpenChange={(open) => (open ? undefined : setLeaving(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar as alterações?</AlertDialogTitle>
            <AlertDialogDescription>O que foi mudado na receita ainda não foi salvo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={discard}>
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

type RecipeRead =
  { status: "loading" } | { status: "failed"; message: string } | { status: "loaded"; data: Recipe | null };

/** The recipe of a product, read once when the sheet opens, with a way to ask again after a failure. */
function useRecipeOf(productSku: string): RecipeRead & { retry: () => void; replace: (recipe: Recipe) => void } {
  const [read, setRead] = useState<RecipeRead>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  // What was just saved is what the server holds: reading it again would only throw the answer away.
  const replace = useCallback((recipe: Recipe) => setRead({ status: "loaded", data: recipe }), []);

  useEffect(() => {
    let current = true;

    setRead({ status: "loading" });
    readRecipe(productSku)
      .then((result) => {
        if (!current) return;
        setRead(
          result.ok
            ? { status: "loaded", data: result.data }
            : { status: "failed", message: messageForFailure(result) },
        );
      })
      .catch((error: unknown) => {
        if (current) setRead({ status: "failed", message: messageForFailure(error) });
      });

    return () => {
      current = false;
    };
  }, [productSku, attempt]);

  return { ...read, retry, replace };
}
