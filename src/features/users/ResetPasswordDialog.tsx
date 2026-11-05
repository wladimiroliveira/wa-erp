"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetUserPassword } from "@/features/users/actions";
import type { User } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";

const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "A senha precisa de pelo menos 8 caracteres."),
    confirmation: z.string().min(1, "Repita a nova senha."),
  })
  .refine((values) => values.newPassword === values.confirmation, {
    path: ["confirmation"],
    message: "As senhas não conferem.",
  });

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

const RESET_MESSAGES = { 404: "Esse usuário já não existe mais. Atualize a lista." };

interface ResetPasswordDialogProps {
  user: User | null;
  onOpenChange: (open: boolean) => void;
}

export function ResetPasswordDialog({ user, onOpenChange }: ResetPasswordDialogProps) {
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {user !== null ? (
          <>
            <DialogHeader>
              <DialogTitle>Redefinir senha de {user.name}</DialogTitle>
            </DialogHeader>
            <ResetPasswordForm key={user.id} user={user} onDone={() => onOpenChange(false)} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const form = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", confirmation: "" },
  });

  const { errors } = form.formState;

  function reset({ newPassword }: ResetPasswordForm): void {
    startSaving(async () => {
      try {
        const result = await resetUserPassword(user.id, { newPassword });

        if (!result.ok) {
          setFailure(messageForFailure(result, RESET_MESSAGES));
          return;
        }

        // The server also ended every session the user had open, so the next request they make
        // lands on the sign-in screen. Saying so spares the admin a surprised phone call.
        toast.success(`Senha redefinida. ${user.name} precisa entrar de novo.`);
        onDone();
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        setFailure(null);
        reset(values);
      })}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="reset-new-password">Nova senha</Label>
        <Input
          id="reset-new-password"
          type="password"
          autoComplete="new-password"
          autoFocus
          {...form.register("newPassword")}
        />
        {errors.newPassword ? <p className="text-sm text-destructive">{errors.newPassword.message}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="reset-confirmation">Repita a nova senha</Label>
        <Input id="reset-confirmation" type="password" autoComplete="new-password" {...form.register("confirmation")} />
        {errors.confirmation ? <p className="text-sm text-destructive">{errors.confirmation.message}</p> : null}
      </div>

      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          Redefinir
        </Button>
      </DialogFooter>
    </form>
  );
}
