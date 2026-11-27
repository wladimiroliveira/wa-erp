"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { previewSubstitution, substituteProductionItem } from "@/features/productions/actions";
import { ITEM_MESSAGES } from "@/features/productions/item-messages";
import { quantityOf } from "@/features/stock/stock-format";
import type { ProductionItem, ProductionSubstitution } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";
import { toScaled } from "@/shared/fixed-point";

export function SubstituteItemDialog({ productionId, item }: { productionId: string; item: ProductionItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ProductionSubstitution | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  async function openDialog(): Promise<void> {
    setOpen(true);
    setPreview(null);
    setFailure(null);

    try {
      const result = await previewSubstitution(productionId, item.id);

      if (result.ok) setPreview(result.data);
      else setFailure(messageForFailure(result, ITEM_MESSAGES));
    } catch (error) {
      setFailure(messageForFailure(error));
    }
  }

  function confirm(): void {
    setFailure(null);
    startSaving(async () => {
      try {
        const result = await substituteProductionItem(productionId, item.id);

        if (!result.ok) {
          // Something changed the item first: the refresh shows it as it now stands and takes this
          // dialog off the page, so the explanation goes where it survives that.
          if (result.status === 409) {
            toast.error(messageForFailure(result, ITEM_MESSAGES));
            setOpen(false);
            router.refresh();
          } else {
            setFailure(messageForFailure(result, ITEM_MESSAGES));
          }
          return;
        }

        toast.success("Estoque usado no lugar do item.");
        router.refresh();
        setOpen(false);
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  const short = preview !== null && toScaled(preview.available, 6) < toScaled(preview.needed, 6);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => void openDialog()}>
        Usar do estoque
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setFailure(null);
          setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usar do estoque no lugar de {item.product.description}?</AlertDialogTitle>
            <AlertDialogDescription>
              {preview === null
                ? "Consultando o estoque…"
                : `No estoque: ${quantityOf(preview.available, preview.product.unit)} · necessário: ${quantityOf(preview.needed, preview.product.unit)}`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {short ? <p className="text-sm text-destructive">O estoque não cobre o necessário.</p> : null}

          {failure !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Kept open until the server answers, so a refusal is read inside the dialog.
                event.preventDefault();
                confirm();
              }}
              disabled={saving}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
