"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { concludeItem, previewLeftovers } from "@/features/productions/actions";
import { progressOf } from "@/features/productions/batch-progress";
import { LeftoversInCostCheckbox, LeftoversSection } from "@/features/productions/LeftoversSection";
import { ShortageDialog } from "@/features/productions/ShortageDialog";
import { quantityOf } from "@/features/stock/stock-format";
import type { FinishConflict, LeftoversPreview, Production, ProductionItem } from "@/lib/api";
import { messageForFailure } from "@/lib/form-errors";
import { BATCH_EXPIRED } from "@/server/modules/productions/productions.schemas";

const CONCLUDE_MESSAGES = {
  404: "Essa produção não existe mais.",
  409: "Um item mudou enquanto isso. A página foi atualizada.",
};

// Items asked to conclude while others they take are pending: what each waits for, as the server said.
function waitingMessageOf(conflict: FinishConflict | undefined): string | null {
  if (!conflict?.waitingFor?.length) return null;

  const lines = conflict.waitingFor.map(
    ({ product, waitsFor }) =>
      `${product.description} aguarda ${waitsFor.map((other) => other.product.description).join(", ")}.`,
  );

  return `${lines.join(" ")} A página foi atualizada.`;
}

// An intermediate short of its target: what the items that take it would lack, as the server said.
const missingMessageOf = (missing: NonNullable<FinishConflict["missing"]>): string =>
  missing
    .map(
      ({ product, quantity }) =>
        `Falta ${quantityOf(quantity, product.unit)} de ${product.description} para o que vem depois. Registre ou pese mais uma leva.`,
    )
    .join(" ");

/**
 * Concludes one item with what its levas add up to. The call site keys it by production and item, so
 * a refresh keeps the choice made; the form only starts over when it is for another item.
 */
export function ConcludeItemForm({ production, item }: { production: Production; item: ProductionItem }) {
  const router = useRouter();
  const description = item.product.description;
  const [failure, setFailure] = useState<string | null>(null);
  // What the stock lacks to conclude, while the user picks a way out of it.
  const [shortage, setShortage] = useState<FinishConflict | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [concluding, startConcluding] = useTransition();
  // What concluding would discard, as the stock stood when the form opened; only a guide, the server
  // works it out again when the item concludes.
  // Kept with the production it was asked for: one brought anew by a refresh is still being worked out.
  const [preview, setPreview] = useState<{ of: Production; leftovers: LeftoversPreview | "failed" } | null>(null);
  const [inCost, setInCost] = useState(true);
  const leftovers = preview?.of === production ? preview.leftovers : null;
  const progress = progressOf(item);
  // An item ends short of its target only once the operator says so; the server still refuses an
  // intermediate whose takers would lack it.
  const asksFirst = !progress.reached;

  useEffect(() => {
    let current = true;

    previewLeftovers(production.id, [item.id])
      .then((result) => {
        if (current) setPreview({ of: production, leftovers: result.ok ? result.data : "failed" });
      })
      .catch(() => {
        if (current) setPreview({ of: production, leftovers: "failed" });
      });

    return () => {
      current = false;
    };
    // A refreshed page brings the production anew, and the stock may have moved since: ask again.
  }, [production, item.id]);

  function conclude(): void {
    setFailure(null);
    setConfirming(false);
    startConcluding(async () => {
      try {
        const body = progress.reached
          ? { hasLeftoversInCost: inCost }
          : { hasLeftoversInCost: inCost, belowTarget: true };
        const result = await concludeItem(production.id, item.id, body);

        if (!result.ok) {
          // A 409 on concluding carries what blocks it, when the server knows.
          const conflict = result.status === 409 ? (result.details as FinishConflict | undefined) : undefined;

          // Intermediates short in stock: the production stays open, so this form stays on the page
          // to say what to do.
          if (conflict?.shortages?.length) {
            setShortage(conflict);
            return;
          }

          // Nothing changed meanwhile: the item stays, and more levas are what it takes.
          if (conflict?.missing?.length) {
            setFailure(missingMessageOf(conflict.missing));
            return;
          }

          // Nothing changed meanwhile either: the leva with the wrong expiry is the operator's to fix.
          if (result.status === 409 && result.message === BATCH_EXPIRED) {
            setFailure("Uma leva está com a validade vencida. Remova e registre de novo com a validade certa.");
            return;
          }

          // A 409 refreshes the page, and a production closed meanwhile takes this form off it: the
          // explanation goes where it survives that.
          if (result.status === 409) {
            toast.error(waitingMessageOf(conflict) ?? messageForFailure(result, CONCLUDE_MESSAGES));
            router.refresh();
          } else {
            setFailure(messageForFailure(result, CONCLUDE_MESSAGES));
          }
          return;
        }

        // Concluding an item may leave the production open: say which of the two happened.
        toast.success(result.data.status === "FINISHED" ? "Produção finalizada." : "Item concluído.");
        router.refresh();
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  const q = (quantity: string) => quantityOf(quantity, item.product.unit);

  return (
    <div className="flex flex-col gap-4">
      {/* Announced as it arrives: it changes what concluding will do. */}
      <div role="status" aria-live="polite">
        {leftovers === null ? (
          <p className="text-sm text-muted-foreground">Calculando as sobras…</p>
        ) : leftovers === "failed" ? (
          // The server still finds the leftovers when it concludes, so the choice stays the user's.
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Não foi possível calcular as sobras.</p>
            <LeftoversInCostCheckbox inCost={inCost} onInCostChange={setInCost} />
          </div>
        ) : leftovers.items.some((previewed) => previewed.leftovers.length > 0) ? (
          <LeftoversSection preview={leftovers} inCost={inCost} onInCostChange={setInCost} />
        ) : null}
      </div>

      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      {/* Not before a leva exists, nor before the leftovers are known: their cost is the user's to keep out. */}
      <Button
        type="button"
        className="self-start"
        disabled={concluding || leftovers === null || item.batches.length === 0}
        onClick={() => (asksFirst ? setConfirming(true) : conclude())}
      >
        Concluir {description}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Rendeu ${q(progress.produced)} de ${q(item.expectedQuantity)}. Concluir assim?`}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={conclude}>Concluir assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {shortage !== null ? (
        <ShortageDialog production={production} conflict={shortage} onClose={() => setShortage(null)} />
      ) : null}
    </div>
  );
}
