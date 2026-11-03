"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { IconButton } from "@/components/common/IconButton";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { SupplierDialog } from "@/features/suppliers/SupplierDialog";
import type { Supplier } from "@/lib/api";
import { PageTitle } from "@/components/layout/PageTitle";

export function SuppliersListPage({ suppliers }: { suppliers: Supplier[] }) {
  const { can } = useSession();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Fornecedores</PageTitle>

      {suppliers.length === 0 ? (
        <EmptyState
          actions={
            can("CATALOG_CREATE") ? (
              <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
                Novo fornecedor
              </Button>
            ) : null
          }
        >
          Nenhum fornecedor cadastrado ainda.
        </EmptyState>
      ) : (
        <ArrangeableTable
          tableKey="suppliers"
          actions={
            can("CATALOG_CREATE") ? (
              <IconButton label="Novo fornecedor" variant="default" onClick={() => setDialogOpen(true)}>
                <PlusIcon aria-hidden="true" />
              </IconButton>
            ) : null
          }
          rowNoun={{ one: "fornecedor", other: "fornecedores" }}
          fill
          rows={suppliers}
          rowKey={(supplier) => supplier.id}
          columns={[{ key: "name", header: "Nome", cell: (supplier) => supplier.name }]}
        />
      )}

      <SupplierDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
