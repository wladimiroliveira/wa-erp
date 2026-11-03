"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { IconButton } from "@/components/common/IconButton";
import { RowActions, RowActionsItem } from "@/components/common/RowActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { useSession } from "@/features/auth/use-session";
import { DeleteRoleDialog } from "@/features/roles/DeleteRoleDialog";
import { RoleDialog } from "@/features/roles/RoleDialog";
import type { Role } from "@/lib/api";
import { labelFor } from "@/lib/permissions";
import { PageTitle } from "@/components/layout/PageTitle";

export function RolesListPage({ roles }: { roles: Role[] }) {
  const { can } = useSession();
  const [editing, setEditing] = useState<Role | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);

  function openFor(role: Role | null): void {
    setEditing(role);
    setDialogOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Papéis</PageTitle>

      {roles.length === 0 ? (
        <EmptyState
          actions={
            can("ACCESS_CREATE") ? (
              <Button type="button" variant="outline" onClick={() => openFor(null)}>
                Novo papel
              </Button>
            ) : null
          }
        >
          Nenhum papel cadastrado ainda.
        </EmptyState>
      ) : (
        <ArrangeableTable
          tableKey="roles"
          actions={
            can("ACCESS_CREATE") ? (
              <IconButton label="Novo papel" variant="default" onClick={() => openFor(null)}>
                <PlusIcon aria-hidden="true" />
              </IconButton>
            ) : null
          }
          rowNoun={{ one: "papel", other: "papéis" }}
          fill
          rows={roles}
          rowKey={(role) => role.id}
          columns={[
            { key: "name", header: "Nome", cell: (role) => role.name },
            {
              key: "permissions",
              header: "Permissões",
              cell: (role) => (
                <div className="flex flex-wrap gap-1">
                  {role.permissions.map((permission) => (
                    <Badge key={permission} variant="secondary">
                      {labelFor(permission)}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              key: "actions",
              header: "Ações",
              cell: (role) =>
                can("ACCESS_UPDATE") ? (
                  <RowActions label={`Ações de ${role.name}`}>
                    <RowActionsItem onClick={() => openFor(role)}>Editar</RowActionsItem>
                    <RowActionsItem variant="destructive" onClick={() => setDeleting(role)}>
                      Excluir
                    </RowActionsItem>
                  </RowActions>
                ) : null,
            },
          ]}
        />
      )}

      <RoleDialog role={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <DeleteRoleDialog role={deleting} onOpenChange={(open) => setDeleting(open ? deleting : null)} />
    </div>
  );
}
