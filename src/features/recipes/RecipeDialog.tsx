"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecipeForm, recipeTitle } from "@/features/recipes/RecipeForm";
import type { Product } from "@/lib/api";

interface RecipeDialogProps {
  /** The product to write the first recipe of, or `null` while there is none to ask about. */
  product: Product | null;
  /** The products an ingredient is chosen from. */
  catalog: Product[];
  onClose: () => void;
}

/** Starts the recipe of a product that has none, right where the product came to exist. */
export function RecipeDialog({ product, catalog, onClose }: RecipeDialogProps) {
  return (
    <Dialog open={product !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {product !== null ? (
          <>
            <DialogHeader>
              <DialogTitle>{recipeTitle(product, null)}</DialogTitle>
            </DialogHeader>

            <RecipeForm
              key={product.sku}
              product={product}
              recipe={null}
              catalog={catalog}
              onSaved={onClose}
              secondaryAction={
                <Button type="button" variant="outline" onClick={onClose}>
                  Deixar para depois
                </Button>
              }
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
