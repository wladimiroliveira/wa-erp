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
import { deleteRole } from "@/features/roles/actions";
import type { Role } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";

interface DeleteRoleDialogProps {
  role: Role | null;
  onOpenChange: (open: boolean) => void;
}

export function DeleteRoleDialog({ role, onOpenChange }: DeleteRoleDialogProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();

  function remove(id: string): void {
    startRemoving(async () => {
      try {
        const result = await deleteRole(id);

        // Someone else deleted it first. The operator asked for it gone and it is
        // gone: that is the outcome they wanted, not an error to explain.
        if (!result.ok && result.status !== 404) {
          setFailure(messageForFailure(result));
          return;
        }

        router.refresh();
        toast.success(result.ok ? "Papel excluído." : "Esse papel já havia sido excluído.");
        onOpenChange(false);
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  return (
    <AlertDialog
      open={role !== null}
      onOpenChange={(open) => {
        if (!open) setFailure(null);
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Excluir o papel "${role?.name ?? ""}"?`}</AlertDialogTitle>
          <AlertDialogDescription>
            Quem tiver esse papel fica sem as permissões que ele dava. Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {failure !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Defensive, not load-bearing: this kit's `AlertDialogAction` is a plain
              // Button with no dismiss behaviour of its own, and what opens or closes this
              // dialog is `role !== null` alone. The call stays so a future kit swap, or
              // moving this into a form, cannot turn a failed delete into a dialog that
              // closes and leaves the operator unsure whether it worked.
              event.preventDefault();
              setFailure(null);
              if (role !== null) remove(role.id);
            }}
            disabled={removing}
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
