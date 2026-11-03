"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Product } from "@/lib/api";

interface NewRecipeDialogProps {
  open: boolean;
  /** The products a new recipe can be written for: those that have none yet. */
  candidates: Product[];
  onClose: () => void;
  onChoose: (product: Product) => void;
}

/** Asks which product a new recipe is for, before the recipe itself is written. */
export function NewRecipeDialog({ open, candidates, onClose, onChoose }: NewRecipeDialogProps) {
  const [sku, setSku] = useState("");
  const [missing, setMissing] = useState(false);

  // Each opening starts with nothing chosen.
  useEffect(() => {
    setSku("");
    setMissing(false);
  }, [open]);

  function proceed(): void {
    const chosen = candidates.find((product) => product.sku === sku);

    if (chosen === undefined) setMissing(true);
    else onChoose(chosen);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova receita</DialogTitle>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p>Todos os produtos fabricados ativos já têm receita.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-recipe-product">Produto</Label>
            <NativeSelect
              id="new-recipe-product"
              value={sku}
              onChange={(event) => {
                setSku(event.target.value);
                setMissing(false);
              }}
            >
              <option value="">Selecione um produto</option>
              {candidates.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {product.description}
                </option>
              ))}
            </NativeSelect>
            {missing ? <p className="text-sm text-destructive">Escolha o produto.</p> : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {candidates.length === 0 ? "Fechar" : "Cancelar"}
          </Button>
          {candidates.length === 0 ? null : (
            <Button type="button" onClick={proceed}>
              Continuar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
