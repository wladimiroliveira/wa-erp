"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { finishProductionItems, previewLeftovers } from "@/features/productions/actions";
import { LeftoversInCostCheckbox, LeftoversSection } from "@/features/productions/LeftoversSection";
import { ShortageDialog } from "@/features/productions/ShortageDialog";
import type { FinishConflict, LeftoversPreview, Production, ProductionItem } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { positiveDecimal } from "@/lib/form-schemas";
import { unitLabel } from "@/lib/units";

const producedSchema = positiveDecimal(
  "Informe o produzido, com até 6 casas decimais.",
  "O produzido deve ser maior que zero.",
);

// The expiry is optional: a blank one is a lot that does not expire.
const finishFormSchema = z
  .object({ producedQuantity: z.string(), expiresAt: z.string() })
  .superRefine((values, context) => {
    const produced = producedSchema.safeParse(values.producedQuantity);

    if (!produced.success) {
      context.addIssue({ code: "custom", path: ["producedQuantity"], message: produced.error.issues[0]!.message });
    }
    if (values.expiresAt !== "" && values.expiresAt < todayIso()) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "A validade não pode estar no passado." });
    }
  });

type FinishFormValues = z.infer<typeof finishFormSchema>;

const FINISH_MESSAGES = {
  404: "Essa produção não existe mais.",
  409: "Um item mudou enquanto isso. A página foi atualizada.",
};

// Items asked to finish while others they take are pending: what each waits for, as the server said.
function waitingMessageOf(conflict: FinishConflict | undefined): string | null {
  if (!conflict?.waitingFor?.length) return null;

  const lines = conflict.waitingFor.map(
    ({ product, waitsFor }) =>
      `${product.description} aguarda ${waitsFor.map((other) => other.product.description).join(", ")}.`,
  );

  return `${lines.join(" ")} A página foi atualizada.`;
}

// The form of one stage: it finishes its own item. The call site keys it by production and item, so a
// refresh keeps what was typed; the form only starts over when it is for another item.
export function FinishItemForm({ production, item }: { production: Production; item: ProductionItem }) {
  const router = useRouter();
  const description = item.product.description;
  const [failure, setFailure] = useState<string | null>(null);
  // What the stock lacks to finish, while the user picks a way out of it.
  const [shortage, setShortage] = useState<FinishConflict | null>(null);
  const [finishing, startFinishing] = useTransition();
  // What finishing would discard, as the stock stood when the form opened; only a guide, the server
  // works it out again when the item finishes.
  // Kept with the production it was asked for: one brought anew by a refresh is still being worked out.
  const [preview, setPreview] = useState<{ of: Production; leftovers: LeftoversPreview | "failed" } | null>(null);
  const [inCost, setInCost] = useState(true);

  const form = useForm<FinishFormValues>({
    resolver: zodResolver(finishFormSchema),
    // Blank on purpose: what gets recorded is what was really produced, never the expected left untouched.
    defaultValues: { producedQuantity: "", expiresAt: "" },
  });
  const leftovers = preview?.of === production ? preview.leftovers : null;

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

  function finish(values: FinishFormValues): void {
    const body = {
      items: [
        {
          id: item.id,
          producedQuantity: toApiDecimal(values.producedQuantity),
          expiresAt: values.expiresAt === "" ? null : values.expiresAt,
        },
      ],
      hasLeftoversInCost: inCost,
    };

    setFailure(null);
    startFinishing(async () => {
      try {
        const result = await finishProductionItems(production.id, body);

        if (!result.ok) {
          // A 409 on finishing carries what blocks it, when the block is the intermediates.
          const conflict = result.status === 409 ? (result.details as FinishConflict | undefined) : undefined;

          // Intermediates short in stock: the production stays open, so this form stays on the page
          // to say what to do.
          if (conflict?.shortages?.length) {
            setShortage(conflict);
            return;
          }

          // A 409 refreshes the page, and a production closed meanwhile takes this form off it: the
          // explanation goes where it survives that.
          if (result.status === 409) {
            toast.error(waitingMessageOf(conflict) ?? messageForFailure(result, FINISH_MESSAGES));
            router.refresh();
          } else {
            setFailure(messageForFailure(result, FINISH_MESSAGES));
          }
          return;
        }

        // Finishing some items leaves the production open: say which of the two happened.
        toast.success(result.data.status === "FINISHED" ? "Produção finalizada." : "Itens finalizados.");
        router.refresh();
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  const errors = form.formState.errors;
  const quantityId = `finish-${item.id}-quantity`;
  const expiryId = `finish-${item.id}-expires-at`;

  return (
    <>
      <form
        onSubmit={form.handleSubmit(finish)}
        aria-label={`Finalizar ${description}`}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={quantityId}>Produzido ({unitLabel(item.product.unit)})</Label>
            <NumericInput
              id={quantityId}
              aria-label={`Produzido de ${description}`}
              // Filled with the page's background: on the highlighted card a transparent field reads poorly.
              className="bg-background"
              {...form.register("producedQuantity")}
            />
            {errors.producedQuantity ? (
              <p className="text-sm text-destructive">{errors.producedQuantity.message}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={expiryId}>Validade (opcional)</Label>
            <Input
              id={expiryId}
              type="date"
              min={todayIso()}
              aria-label={`Validade de ${description}`}
              className="bg-background"
              {...form.register("expiresAt")}
            />
            {errors.expiresAt ? <p className="text-sm text-destructive">{errors.expiresAt.message}</p> : null}
          </div>
        </div>

        {/* Announced as it arrives: it comes after the form, and changes what finishing will do. */}
        <div role="status" aria-live="polite">
          {leftovers === null ? (
            <p className="text-sm text-muted-foreground">Calculando as sobras…</p>
          ) : leftovers === "failed" ? (
            // The server still finds the leftovers when it finishes, so the choice stays the user's.
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

        {/* Not before the leftovers are known: their cost is the user's to keep out. */}
        <Button type="submit" className="self-start" disabled={finishing || leftovers === null}>
          Finalizar {description}
        </Button>
      </form>

      {/* Outside the form: React carries a submit inside the dialog up to this form, portal or not. */}
      {shortage !== null ? (
        <ShortageDialog
          production={production}
          conflict={shortage}
          onClose={() => setShortage(null)}
          onReduced={() => {
            // The page brings the reduced production anew, inputs and leftovers included.
            setShortage(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
