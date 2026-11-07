"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { finishProduction } from "@/features/productions/actions";
import type { Production } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { positiveDecimal } from "@/lib/form-schemas";
import { unitLabel } from "@/lib/units";

// One row per item of the production, in its order. The expiry is optional: a blank one is a lot
// that does not expire.
const finishFormSchema = z.object({
  items: z.array(
    z.object({
      producedQuantity: positiveDecimal(
        "Informe o produzido, com até 6 casas decimais.",
        "O produzido deve ser maior que zero.",
      ),
      expiresAt: z.string().refine((day) => day === "" || day >= todayIso(), {
        message: "A validade não pode estar no passado.",
      }),
    }),
  ),
});

type FinishFormValues = z.infer<typeof finishFormSchema>;

const FINISH_MESSAGES = {
  404: "Essa produção não existe mais.",
  409: "A produção já foi finalizada ou cancelada, ou o custo ficou fora do limite. A página foi atualizada.",
};

export function FinishProductionForm({ production }: { production: Production }) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [finishing, startFinishing] = useTransition();

  const form = useForm<FinishFormValues>({
    resolver: zodResolver(finishFormSchema),
    // Blank on purpose: what gets recorded is what was really produced, never the expected left untouched.
    defaultValues: { items: production.items.map(() => ({ producedQuantity: "", expiresAt: "" })) },
  });

  function finish(values: FinishFormValues): void {
    const body = {
      items: production.items.map((item, index) => ({
        id: item.id,
        producedQuantity: toApiDecimal(values.items[index]!.producedQuantity),
        expiresAt: values.items[index]!.expiresAt === "" ? null : values.items[index]!.expiresAt,
      })),
    };

    setFailure(null);
    startFinishing(async () => {
      try {
        const result = await finishProduction(production.id, body);

        if (!result.ok) {
          // A 409 refreshes the page, and a production closed meanwhile takes this form off it: the
          // explanation goes where it survives that.
          if (result.status === 409) {
            toast.error(messageForFailure(result, FINISH_MESSAGES));
            router.refresh();
          } else {
            setFailure(messageForFailure(result, FINISH_MESSAGES));
          }
          return;
        }

        toast.success("Produção finalizada.");
        router.refresh();
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  const errors = form.formState.errors.items;

  return (
    <form
      onSubmit={form.handleSubmit(finish)}
      aria-label="Finalizar produção"
      className="flex flex-col gap-4 rounded-md border p-4"
      noValidate
    >
      <h2 className="text-lg font-semibold">Finalizar produção</h2>

      {production.items.map((item, index) => {
        const quantityId = `finish-${item.id}-quantity`;
        const expiryId = `finish-${item.id}-expires-at`;

        return (
          <div key={item.id} className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={quantityId}>
                Produzido de {item.product.description} ({unitLabel(item.product.unit)})
              </Label>
              <NumericInput
                id={quantityId}
                aria-label={`Produzido de ${item.product.description}`}
                {...form.register(`items.${index}.producedQuantity`)}
              />
              {errors?.[index]?.producedQuantity ? (
                <p className="text-sm text-destructive">{errors[index].producedQuantity.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={expiryId}>Validade de {item.product.description} (opcional)</Label>
              <Input
                id={expiryId}
                type="date"
                min={todayIso()}
                aria-label={`Validade de ${item.product.description}`}
                {...form.register(`items.${index}.expiresAt`)}
              />
              {errors?.[index]?.expiresAt ? (
                <p className="text-sm text-destructive">{errors[index].expiresAt.message}</p>
              ) : null}
            </div>
          </div>
        );
      })}

      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      <Button type="submit" className="self-start" disabled={finishing}>
        Finalizar produção
      </Button>
    </form>
  );
}
