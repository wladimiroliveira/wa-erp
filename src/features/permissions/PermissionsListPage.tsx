"use client";

import { PageTitle } from "@/components/layout/PageTitle";
import { Badge } from "@/components/ui/badge";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import type { Permission, Role } from "@/lib/api";
import { labelFor, PERMISSION_GROUPS } from "@/lib/permissions";

interface PermissionRow {
  permission: Permission;
  group: string;
  roles: Role[];
}

// Permissions are a fixed list owned by the code, not records anyone creates. What varies, and
// what this screen is for, is which roles hand each one out.
function rowsFor(roles: Role[]): PermissionRow[] {
  return PERMISSION_GROUPS.flatMap(({ title, permissions }) =>
    permissions.map((permission) => ({
      permission,
      group: title,
      roles: roles.filter((role) => role.permissions.includes(permission)),
    })),
  );
}

export function PermissionsListPage({ roles }: { roles: Role[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Permissões</PageTitle>

      <ArrangeableTable
        tableKey="permissions"
        rowNoun={{ one: "permissão", other: "permissões" }}
        fill
        rows={rowsFor(roles)}
        rowKey={(row) => row.permission}
        columns={[
          { key: "group", header: "Grupo", cell: (row) => row.group },
          { key: "label", header: "Permissão", cell: (row) => labelFor(row.permission) },
          {
            key: "code",
            header: "Código",
            cell: (row) => <code className="text-muted-foreground text-xs">{row.permission}</code>,
          },
          {
            key: "roles",
            header: "Papéis",
            cell: (row) =>
              row.roles.length === 0 ? (
                <span className="text-muted-foreground">Nenhum papel</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {row.roles.map((role) => (
                    <Badge key={role.id} variant="secondary">
                      {role.name}
                    </Badge>
                  ))}
                </div>
              ),
          },
        ]}
      />
    </div>
  );
}
