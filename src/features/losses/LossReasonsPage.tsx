"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { IconButton } from "@/components/common/IconButton";
import { RowActions, RowActionsItem } from "@/components/common/RowActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrangeableTable } from "@/features/table-layouts/ArrangeableTable";
import { LossReasonDialog } from "@/features/losses/LossReasonDialog";
import { updateLossReason } from "@/features/losses/actions";
import type { LossReason } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";
import { PageTitle } from "@/components/layout/PageTitle";

export function LossReasonsPage({ reasons }: { reasons: LossReason[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<LossReason | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toggling, startToggling] = useTransition();

  // A reason is never deleted: the losses recorded under it still say why. Out of use,
  // it only stops being offered.
  function toggle(reason: LossReason): void {
    startToggling(async () => {
      try {
        const result = await updateLossReason(reason.id, { isActive: !reason.isActive });

        if (!result.ok) toast.error(messageForFailure(result));
        else router.refresh();
      } catch (error) {
        toast.error(messageForFailure(error));
      }
    });
  }

  function openFor(reason: LossReason | null): void {
    setEditing(reason);
    setDialogOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle>Modalidades de avaria</PageTitle>

      {reasons.length === 0 ? (
        <EmptyState
          actions={
            <Button type="button" variant="outline" onClick={() => openFor(null)}>
              Nova modalidade
            </Button>
          }
        >
          Nenhuma modalidade cadastrada ainda.
        </EmptyState>
      ) : null}

      {reasons.length > 0 ? (
        <ArrangeableTable
          tableKey="loss-reasons"
          actions={
            <IconButton label="Nova modalidade" variant="default" onClick={() => openFor(null)}>
              <PlusIcon aria-hidden="true" />
            </IconButton>
          }
          rowNoun={{ one: "modalidade", other: "modalidades" }}
          fill
          rows={reasons}
          rowKey={(reason) => reason.id}
          columns={[
            { key: "name", header: "Nome", cell: (reason) => reason.name },
            { key: "description", header: "Descrição", cell: (reason) => reason.description ?? "—" },
            {
              key: "status",
              header: "Situação",
              cell: (reason) => (
                <Badge variant={reason.isActive ? "secondary" : "outline"}>
                  {reason.isActive ? "Ativa" : "Inativa"}
                </Badge>
              ),
            },
            {
              key: "actions",
              header: "Ações",
              cell: (reason) => (
                <RowActions label={`Ações de ${reason.name}`}>
                  <RowActionsItem onClick={() => openFor(reason)}>Editar</RowActionsItem>
                  <RowActionsItem disabled={toggling} onClick={() => toggle(reason)}>
                    {reason.isActive ? "Inativar" : "Reativar"}
                  </RowActionsItem>
                </RowActions>
              ),
            },
          ]}
        />
      ) : null}

      <LossReasonDialog reason={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
