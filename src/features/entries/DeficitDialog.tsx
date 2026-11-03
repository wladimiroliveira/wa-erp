import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { DeficitSettlement } from "@/lib/api";

interface DeficitDialogProps {
  /** What is owed, already written for the operator (`Farinha … em 3,5 kg`). Null keeps it closed. */
  owed: string | null;
  onSettle: (settlement: DeficitSettlement) => void;
  onCancel: () => void;
}

/** A negative balance is never settled silently: the operator says how, or the entry is not recorded. */
export function DeficitDialog({ owed, onSettle, onCancel }: DeficitDialogProps) {
  return (
    <AlertDialog
      open={owed !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Estoque negativo</AlertDialogTitle>
          <AlertDialogDescription>{owed}. Como quer lançar esta entrada?</AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>Zerar o saldo antes: o que faltava é ajustado e a entrada inteira fica em estoque.</li>
          <li>Descontar da entrada: o que faltava sai deste lote, e só o restante fica em estoque.</li>
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button type="button" variant="outline" onClick={() => onSettle("DISCOUNT")}>
            Descontar da entrada
          </Button>
          <Button type="button" onClick={() => onSettle("ZERO")}>
            Zerar o saldo antes
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
