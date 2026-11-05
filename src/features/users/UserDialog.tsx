"use client";

import { useState, useTransition } from "react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { PermissionCheckboxes } from "@/features/permissions/PermissionCheckboxes";
import { createUser, updateUser } from "@/features/users/actions";
import type { Permission, Role, User } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";
import { PERMISSIONS } from "@/lib/permissions";

// The username and the password only exist at creation: the server changes neither through an
// edit, and a password is replaced by its own dialog. So the edit form does not validate them.
function userFormSchema(creating: boolean) {
  const anything = z.string();

  return z.object({
    name: z.string().trim().min(1, "Informe o nome.").max(120, "O nome pode ter no máximo 120 caracteres."),
    username: creating
      ? z
          .string()
          .min(3, "O usuário precisa de pelo menos 3 caracteres.")
          .max(40, "O usuário pode ter no máximo 40 caracteres.")
          .regex(/^[a-z0-9._-]*$/, "Use só letras minúsculas, números, ponto, hífen ou sublinhado.")
      : anything,
    password: creating ? z.string().min(8, "A senha precisa de pelo menos 8 caracteres.") : anything,
    roleId: z.string(),
    extraPermissions: z.array(z.enum(PERMISSIONS)),
    isActive: z.boolean(),
  });
}

type UserForm = z.infer<ReturnType<typeof userFormSchema>>;

const CREATE_MESSAGES = {
  409: "Já existe um usuário com esse login.",
  404: "O papel escolhido já não existe mais. Atualize a lista.",
};

const UPDATE_MESSAGES = {
  404: "Esse usuário ou o papel escolhido já não existe mais. Atualize a lista.",
  409: "Você não pode desativar a própria conta nem tirar de si a permissão de editar usuários.",
};

interface UserDialogProps {
  user: User | null;
  roles: Role[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserDialog({ user, roles, open, onOpenChange }: UserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{user === null ? "Novo usuário" : "Editar usuário"}</DialogTitle>
        </DialogHeader>

        {/* The content unmounts when the dialog closes, and the key remounts it when the user
            changes while open; either way the form starts from the user it is given. */}
        <UserFormBody key={user?.id ?? "new"} user={user} roles={roles} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function UserFormBody({ user, roles, onDone }: { user: User | null; roles: Role[]; onDone: () => void }) {
  const router = useRouter();
  const creating = user === null;
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const form = useForm<UserForm>({
    resolver: zodResolver(userFormSchema(creating)),
    defaultValues: {
      name: user?.name ?? "",
      username: user?.username ?? "",
      password: "",
      roleId: user?.roleId ?? "",
      extraPermissions: user?.extraPermissions ?? [],
      isActive: user?.isActive ?? true,
    },
  });

  const { errors } = form.formState;
  const extraPermissions = form.watch("extraPermissions");
  const isActive = form.watch("isActive");

  function save({ name, username, password, roleId, extraPermissions, isActive }: UserForm): void {
    const role = roleId === "" ? null : roleId;

    startSaving(async () => {
      try {
        const result = creating
          ? await createUser({ name, username, password, roleId: role, extraPermissions })
          : await updateUser(user.id, { name, roleId: role, extraPermissions, isActive });

        if (!result.ok) {
          setFailure(messageForFailure(result, creating ? CREATE_MESSAGES : UPDATE_MESSAGES));
          return;
        }

        // The action already revalidated the list; refreshing is what brings the new rows into this render.
        router.refresh();
        toast.success(creating ? "Usuário criado." : "Usuário salvo.");
        onDone();
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  function toggle(permission: Permission, checked: boolean): void {
    const next = checked ? [...extraPermissions, permission] : extraPermissions.filter((item) => item !== permission);

    form.setValue("extraPermissions", next);
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        setFailure(null);
        save(values);
      })}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="user-name">Nome</Label>
        <Input id="user-name" autoFocus {...form.register("name")} />
        {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="user-username">Usuário</Label>
        <Input
          id="user-username"
          autoComplete="off"
          autoCapitalize="none"
          disabled={!creating}
          {...form.register("username")}
        />
        {errors.username ? <p className="text-sm text-destructive">{errors.username.message}</p> : null}
      </div>

      {creating ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="user-password">Senha</Label>
          <Input id="user-password" type="password" autoComplete="new-password" {...form.register("password")} />
          {errors.password ? <p className="text-sm text-destructive">{errors.password.message}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="user-role">Papel</Label>
        <NativeSelect id="user-role" {...form.register("roleId")}>
          <option value="">Sem papel</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium">Permissões extras</legend>
        <p className="text-sm text-muted-foreground">Somam-se às permissões do papel.</p>

        <PermissionCheckboxes idPrefix="user-permission" selected={extraPermissions} onToggle={toggle} />
      </fieldset>

      {!creating ? (
        <div className="flex min-h-8 items-center gap-2">
          <Checkbox
            id="user-active"
            checked={isActive}
            onCheckedChange={(checked) => form.setValue("isActive", checked === true)}
          />
          <Label htmlFor="user-active" className="flex-1 py-1.5">
            Ativo
          </Label>
        </div>
      ) : null}

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
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}
