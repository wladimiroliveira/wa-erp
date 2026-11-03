"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLossReason, updateLossReason } from "@/features/losses/actions";
import type { LossReason } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";

const reasonFormSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da modalidade.").max(60, "O nome pode ter no máximo 60 caracteres."),
  description: z.string().trim().max(300, "A descrição pode ter no máximo 300 caracteres."),
});

type ReasonForm = z.infer<typeof reasonFormSchema>;

const SAVE_MESSAGES = {
  409: "Já existe uma modalidade com esse nome.",
  404: "Essa modalidade já não existe mais. Atualize a lista.",
};

const valuesOf = (reason: LossReason | null): ReasonForm => ({
  name: reason?.name ?? "",
  description: reason?.description ?? "",
});

interface LossReasonDialogProps {
  reason: LossReason | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LossReasonDialog({ reason, open, onOpenChange }: LossReasonDialogProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<ReasonForm>({ resolver: zodResolver(reasonFormSchema), defaultValues: valuesOf(reason) });

  // Reopening the dialog for a different reason must not show the previous one's
  // values; the form is only constructed once.
  useEffect(() => {
    form.reset(valuesOf(reason));
    setFailure(null);
  }, [form, reason, open]);

  async function save({ name, description }: ReasonForm): Promise<void> {
    setSaving(true);

    try {
      // A new reason leaves a blank description out; an edited one says null, or the
      // old description would survive being erased.
      const result =
        reason === null
          ? await createLossReason(description === "" ? { name } : { name, description })
          : await updateLossReason(reason.id, { name, description: description === "" ? null : description });

      if (!result.ok) {
        setFailure(messageForFailure(result, SAVE_MESSAGES));
        return;
      }

      toast.success(reason === null ? "Modalidade cadastrada." : "Modalidade salva.");
      onOpenChange(false);
      // The list under the dialog reads the server again, so the saved reason shows in it.
      router.refresh();
    } catch (error) {
      setFailure(messageForFailure(error));
    } finally {
      setSaving(false);
    }
  }

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{reason === null ? "Nova modalidade" : "Editar modalidade"}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((values) => {
            setFailure(null);
            return save(values);
          })}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-reason-name">Nome</Label>
            <Input id="loss-reason-name" autoFocus autoComplete="off" {...form.register("name")} />
            {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-reason-description">Descrição (opcional)</Label>
            <Input id="loss-reason-description" autoComplete="off" {...form.register("description")} />
            {errors.description ? <p className="text-sm text-destructive">{errors.description.message}</p> : null}
          </div>

          {failure !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
