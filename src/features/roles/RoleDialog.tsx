"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRole, updateRole } from "@/features/roles/actions";
import type { Permission, Role } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";
import { labelFor, PERMISSION_GROUPS, PERMISSIONS } from "@/lib/permissions";

const roleFormSchema = z.object({
  name: z.string().min(1, "Informe o nome do papel.").max(60, "O nome pode ter no máximo 60 caracteres."),
  permissions: z.array(z.enum(PERMISSIONS)).min(1, "Escolha ao menos uma permissão."),
});

type RoleForm = z.infer<typeof roleFormSchema>;

const SAVE_MESSAGES = {
  409: "Já existe um papel com esse nome.",
  404: "Esse papel já não existe mais. Atualize a lista.",
};

interface RoleDialogProps {
  role: Role | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RoleDialog({ role, open, onOpenChange }: RoleDialogProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const form = useForm<RoleForm>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: { name: role?.name ?? "", permissions: role?.permissions ?? [] },
  });

  // Reopening the dialog for a different role must not show the previous one's
  // values; the form is only constructed once.
  useEffect(() => {
    form.reset({ name: role?.name ?? "", permissions: role?.permissions ?? [] });
    setFailure(null);
  }, [form, role, open]);

  const selected = form.watch("permissions");

  function save(values: RoleForm): void {
    startSaving(async () => {
      try {
        const result = role === null ? await createRole(values) : await updateRole(role.id, values);

        if (!result.ok) {
          setFailure(messageForFailure(result, SAVE_MESSAGES));
          return;
        }

        // The action already revalidated the list; refreshing is what brings the new rows into this render.
        router.refresh();
        toast.success(role === null ? "Papel criado." : "Papel salvo.");
        onOpenChange(false);
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  function toggle(permission: Permission, checked: boolean): void {
    const next = checked ? [...selected, permission] : selected.filter((item) => item !== permission);

    form.setValue("permissions", next, { shouldValidate: form.formState.isSubmitted });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role === null ? "Novo papel" : "Editar papel"}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((values) => {
            setFailure(null);
            save(values);
          })}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="role-name">Nome</Label>
            <Input id="role-name" autoFocus {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-4">
            <legend className="text-sm font-medium">Permissões</legend>

            {PERMISSION_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col">
                <p className="text-sm text-muted-foreground">{group.title}</p>

                {group.permissions.map((permission) => (
                  // `min-h-8` is not decoration. The Checkbox carries a 32px invisible hit
                  // area around a 16px box, so in a row only as tall as its text the hit
                  // areas of neighbouring rows overlap — a tap between two of them toggles
                  // whichever wins the z-order, a wrong permission granted, silently.
                  // Sizing the row to the target makes them tile instead.
                  <div key={permission} className="flex min-h-8 items-center gap-2">
                    <Checkbox
                      id={`permission-${permission}`}
                      checked={selected.includes(permission)}
                      onCheckedChange={(checked) => toggle(permission, checked === true)}
                    />
                    <Label htmlFor={`permission-${permission}`} className="flex-1 py-1.5">
                      {labelFor(permission)}
                    </Label>
                  </div>
                ))}
              </div>
            ))}

            {form.formState.errors.permissions ? (
              <p className="text-sm text-destructive">{form.formState.errors.permissions.message}</p>
            ) : null}
          </fieldset>

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
