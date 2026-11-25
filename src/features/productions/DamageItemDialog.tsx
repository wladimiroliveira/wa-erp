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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { damageProductionItem } from "@/features/productions/actions";
import { ITEM_MESSAGES, reasonMessageOf } from "@/features/productions/item-messages";
import type { LossReason, ProductionItem } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";

interface DamageItemDialogProps {
  productionId: string;
  item: ProductionItem;
  lossReasons: LossReason[];
}

export function DamageItemDialog({ productionId, item, lossReasons }: DamageItemDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const idBase = `damage-${item.id}`;

  function confirm(): void {
    setFailure(null);
    startSaving(async () => {
      try {
        const result = await damageProductionItem(productionId, item.id, { reasonId, note: note.trim() || null });

        if (!result.ok) {
          const reasonMessage = reasonMessageOf(result);

          // Something changed the item or the reason first: the refresh shows them as they now stand
          // and takes this dialog off the page, so the explanation goes where it survives that.
          if (reasonMessage !== undefined) {
            toast.error(reasonMessage);
            setOpen(false);
            router.refresh();
          } else if (result.status === 409) {
            toast.error(messageForFailure(result, ITEM_MESSAGES));
            setOpen(false);
            router.refresh();
          } else {
            setFailure(messageForFailure(result, ITEM_MESSAGES));
          }
          return;
        }

        toast.success("Avaria registrada.");
        router.refresh();
        setOpen(false);
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
        Registrar avaria
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
            <AlertDialogTitle>Registrar avaria de {item.product.description}?</AlertDialogTitle>
            <AlertDialogDescription>Os ingredientes vão para as perdas e nada entra no estoque.</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-reason`}>Motivo</Label>
            <NativeSelect
              id={`${idBase}-reason`}
              value={reasonId}
              onChange={(event) => setReasonId(event.target.value)}
            >
              <option value="">Selecione o motivo</option>
              {lossReasons.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-note`}>Observação</Label>
            <Input
              id={`${idBase}-note`}
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {lossReasons.length === 0 ? (
            <p className="text-sm text-destructive">Cadastre um motivo de perda ativo para registrar a avaria.</p>
          ) : null}

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
                confirm();
              }}
              disabled={saving || reasonId === ""}
            >
              Confirmar avaria
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
