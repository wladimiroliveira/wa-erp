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
import { cancelProduction } from "@/features/productions/actions";
import { messageForFailure } from "@/lib/form-errors";

const CANCEL_MESSAGES = {
  404: "Essa produção não existe mais.",
  409: "A produção já foi finalizada ou cancelada. A página foi atualizada.",
};

interface CancelProductionDialogProps {
  productionId: string;
  // Items finished stay: their stock and lots are not undone by canceling.
  hasFinishedItems: boolean;
  // A pending item with batches is concluded with them by canceling: its inputs leave and its lots come in.
  concludesBatches: boolean;
  // A pending item without batches lets its pre-weighing go, back to pending.
  releasesPreWeighings: boolean;
}

// What canceling does to the stock, as the production stands.
// Each fact of the production adds what canceling does to it: finished items stay, items with levas are
// concluded with what was made, and the pre-weighings of the rest are let go.
function consequenceOf({
  hasFinishedItems,
  concludesBatches,
  releasesPreWeighings,
}: Omit<CancelProductionDialogProps, "productionId">) {
  const movesStock = hasFinishedItems || concludesBatches;

  return [
    hasFinishedItems ? "Os itens já finalizados continuam no estoque." : null,
    concludesBatches
      ? "Os itens com levas registradas são concluídos com o que foi feito: os ingredientes saem do estoque e os lotes entram."
      : null,
    releasesPreWeighings
      ? movesStock
        ? "As pré-pesagens dos demais voltam a ficar pendentes."
        : "As pré-pesagens usadas voltam a ficar disponíveis."
      : null,
    movesStock ? null : "O estoque não é alterado.",
  ]
    .filter((sentence) => sentence !== null)
    .join(" ");
}

export function CancelProductionDialog({
  productionId,
  hasFinishedItems,
  concludesBatches,
  releasesPreWeighings,
}: CancelProductionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [canceling, startCanceling] = useTransition();

  function cancel(): void {
    setFailure(null);
    startCanceling(async () => {
      try {
        const result = await cancelProduction(productionId);

        if (!result.ok) {
          // Something else closed it first: the refresh shows it as it now stands and takes this
          // dialog off the page, so the explanation goes where it survives that.
          if (result.status === 409) {
            toast.error(messageForFailure(result, CANCEL_MESSAGES));
            setOpen(false);
            router.refresh();
          } else {
            setFailure(messageForFailure(result, CANCEL_MESSAGES));
          }
          return;
        }

        toast.success("Produção cancelada.");
        router.refresh();
        setOpen(false);
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" className="self-start text-destructive" onClick={() => setOpen(true)}>
        Cancelar produção
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
            <AlertDialogTitle>Cancelar esta produção?</AlertDialogTitle>
            <AlertDialogDescription>
              {consequenceOf({ hasFinishedItems, concludesBatches, releasesPreWeighings })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {failure !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                // Kept open until the server answers, so a refusal is read inside the dialog.
                event.preventDefault();
                cancel();
              }}
              disabled={canceling}
            >
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
