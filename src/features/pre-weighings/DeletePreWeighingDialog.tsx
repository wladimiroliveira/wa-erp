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
import { deletePreWeighing } from "@/features/pre-weighings/actions";
import { messageForFailure } from "@/lib/form-errors";

const DELETE_MESSAGES = {
  404: "Essa pré-pesagem não existe mais.",
  409: "Uma produção usa esta pré-pesagem ou uma registrada com ela. A página foi atualizada.",
};

/** `withStages`: pre-weighings of intermediates were recorded under this one, and go with it. */
export function DeletePreWeighingDialog({ preWeighingId, withStages }: { preWeighingId: string; withStages: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();

  function remove(): void {
    setFailure(null);
    startDeleting(async () => {
      try {
        const result = await deletePreWeighing(preWeighingId);

        if (!result.ok) {
          // A production took it first: the refresh shows it as it now stands and takes this dialog
          // off the page, so the explanation goes where it survives that.
          if (result.status === 409) {
            toast.error(messageForFailure(result, DELETE_MESSAGES));
            setOpen(false);
            router.refresh();
          } else {
            setFailure(messageForFailure(result, DELETE_MESSAGES));
          }
          return;
        }

        toast.success("Pré-pesagem excluída.");
        setOpen(false);
        router.push("/pre-weighings");
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" className="self-start text-destructive" onClick={() => setOpen(true)}>
        Excluir pré-pesagem
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
            <AlertDialogTitle>Excluir esta pré-pesagem?</AlertDialogTitle>
            <AlertDialogDescription>
              A pré-pesagem deixa de existir. O estoque não é alterado.
              {withStages ? " As pré-pesagens dos intermediários registradas com ela também são excluídas." : null}
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
                remove();
              }}
              disabled={deleting}
            >
              Confirmar exclusão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
