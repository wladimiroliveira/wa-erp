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

export function CancelProductionDialog({ productionId }: { productionId: string }) {
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
              As pré-pesagens usadas voltam a ficar disponíveis. O estoque não é alterado.
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
