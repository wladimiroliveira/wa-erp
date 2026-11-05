"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { IconButton } from "@/components/common/IconButton";
import { RowActions, RowActionsItem } from "@/components/common/RowActions";
import { PageTitle } from "@/components/layout/PageTitle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { ResetPasswordDialog } from "@/features/users/ResetPasswordDialog";
import { UserDialog } from "@/features/users/UserDialog";
import type { Role, User } from "@/lib/api";
import { labelFor } from "@/lib/permissions";

export function UsersListPage({ users, roles }: { users: User[]; roles: Role[] }) {
  const { can } = useSession();
  const [editing, setEditing] = useState<User | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);

  const roleNames = new Map(roles.map((role) => [role.id, role.name]));

  function openFor(user: User | null): void {
    setEditing(user);
    setDialogOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Usuários</PageTitle>

      {users.length === 0 ? (
        <EmptyState
          actions={
            can("ACCESS_CREATE") ? (
              <Button type="button" variant="outline" onClick={() => openFor(null)}>
                Novo usuário
              </Button>
            ) : null
          }
        >
          Nenhum usuário cadastrado ainda.
        </EmptyState>
      ) : (
        <ArrangeableTable
          tableKey="users"
          actions={
            can("ACCESS_CREATE") ? (
              <IconButton label="Novo usuário" variant="default" onClick={() => openFor(null)}>
                <PlusIcon aria-hidden="true" />
              </IconButton>
            ) : null
          }
          rowNoun={{ one: "usuário", other: "usuários" }}
          fill
          rows={users}
          rowKey={(user) => user.id}
          columns={[
            { key: "name", header: "Nome", cell: (user) => user.name },
            { key: "username", header: "Usuário", cell: (user) => user.username },
            {
              key: "role",
              header: "Papel",
              cell: (user) =>
                (user.roleId !== null ? roleNames.get(user.roleId) : undefined) ?? (
                  <span className="text-muted-foreground">Sem papel</span>
                ),
            },
            {
              key: "extraPermissions",
              header: "Permissões extras",
              cell: (user) => (
                <div className="flex flex-wrap gap-1">
                  {user.extraPermissions.map((permission) => (
                    <Badge key={permission} variant="secondary">
                      {labelFor(permission)}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              key: "status",
              header: "Situação",
              cell: (user) =>
                user.isActive ? <Badge variant="outline">Ativo</Badge> : <Badge variant="destructive">Inativo</Badge>,
            },
            {
              key: "actions",
              header: "Ações",
              cell: (user) =>
                can("ACCESS_UPDATE") ? (
                  <RowActions label={`Ações de ${user.name}`}>
                    <RowActionsItem onClick={() => openFor(user)}>Editar</RowActionsItem>
                    <RowActionsItem onClick={() => setResetting(user)}>Redefinir senha</RowActionsItem>
                  </RowActions>
                ) : null,
            },
          ]}
        />
      )}

      <UserDialog user={editing} roles={roles} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ResetPasswordDialog user={resetting} onOpenChange={(open) => setResetting(open ? resetting : null)} />
    </div>
  );
}
