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
import { recordBatch, removeBatch, type ProductionResult } from "@/features/productions/actions";
import { ItemWeighingPanel } from "@/features/productions/ItemWeighingPanel";
import { progressOf, progressTextOf } from "@/features/productions/batch-progress";
import { quantityOf } from "@/features/stock/stock-format";
import type { Production, ProductionBatch, ProductionItem } from "@/lib/api";
import { formatDate, formatDateTime, todayIso } from "@/lib/dates";
import { toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { positiveDecimal } from "@/lib/form-schemas";

const BATCH_MESSAGES = {
  404: "Essa produção não existe mais.",
  409: "Um item mudou enquanto isso. A página foi atualizada.",
};

// The expiry is optional: a blank one is a lot that does not expire.
const batchFormSchema = z.object({
  quantity: positiveDecimal("Informe a quantidade, com até 6 casas decimais.", "A quantidade deve ser maior que zero."),
  expiresAt: z.string().refine((day) => day === "" || day >= todayIso(), "A validade não pode estar no passado."),
});

type BatchFormValues = z.infer<typeof batchFormSchema>;

type Source = ProductionBatch["source"];

/**
 * Settles what the server answered to a change of the levas. A 409 is a page out of date: the
 * refresh shows it as it now stands, and the explanation goes where it survives that.
 */
function useBatchWrite() {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function write(send: () => Promise<ProductionResult>, onDone?: () => void): void {
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await send();

        if (!result.ok) {
          if (result.status === 409) {
            toast.error(messageForFailure(result, BATCH_MESSAGES));
            router.refresh();
          } else {
            setFailure(messageForFailure(result, BATCH_MESSAGES));
          }
          return;
        }

        onDone?.();
        router.refresh();
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  return { failure, pending, write };
}

function Failure({ message }: { message: string | null }) {
  return message !== null ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function Progress({ item }: { item: ProductionItem }) {
  const { produced } = progressOf(item);
  const expected = Number(item.expectedQuantity);
  // A bar never runs past its end: what was made beyond the target shows in the text.
  const now = Math.min(Number(produced), expected);
  const width = expected > 0 ? (now / expected) * 100 : 100;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{progressTextOf(item)}</p>
      <div
        role="progressbar"
        aria-label={`Progresso de ${item.product.description}`}
        aria-valuemin={0}
        aria-valuemax={expected}
        aria-valuenow={now}
        className="h-2 w-full overflow-hidden rounded-full bg-background"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function BatchList({ production, item, canRecord }: BatchesSectionProps) {
  const { failure, pending, write } = useBatchWrite();

  if (item.batches.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={`Levas de ${item.product.description}`} className="flex flex-col gap-1 text-sm">
        {item.batches.map((batch) => {
          const at = formatDateTime(batch.createdAt);

          return (
            <li key={batch.id} className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
              <time dateTime={batch.createdAt} className="text-muted-foreground tabular-nums">
                {at}
              </time>
              <span className="font-medium tabular-nums">{quantityOf(batch.quantity, item.product.unit)}</span>
              <span className="text-muted-foreground">
                {batch.expiresAt !== null ? formatDate(batch.expiresAt) : "sem validade"}
              </span>
              {batch.source === "EXISTING" ? <span className="text-muted-foreground">já existia</span> : null}
              {canRecord ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  aria-label={`Remover leva de ${at}`}
                  disabled={pending}
                  onClick={() => write(() => removeBatch(production.id, item.id, batch.id))}
                >
                  Remover
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Failure message={failure} />
    </div>
  );
}

/** One form for a leva made now or for product that already existed: the same fields, sent as either. */
function BatchForm({ production, item, onWeigh }: Omit<BatchesSectionProps, "canRecord"> & { onWeigh: () => void }) {
  const description = item.product.description;
  const [source, setSource] = useState<Source>("PRODUCED");
  const { failure, pending, write } = useBatchWrite();
  const form = useForm<BatchFormValues>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: { quantity: "", expiresAt: "" },
  });

  function submit(values: BatchFormValues): void {
    const body = {
      quantity: toApiDecimal(values.quantity),
      expiresAt: values.expiresAt === "" ? null : values.expiresAt,
      source,
    };

    write(
      () => recordBatch(production.id, item.id, body),
      () => {
        form.reset();
        setSource("PRODUCED");
      },
    );
  }

  const errors = form.formState.errors;
  const quantityId = `batch-${item.id}-quantity`;
  const expiryId = `batch-${item.id}-expires-at`;
  const existing = source === "EXISTING";

  return (
    <form
      onSubmit={form.handleSubmit(submit)}
      aria-label={existing ? `Lançar do que já existe de ${description}` : `Registrar leva de ${description}`}
      className="flex flex-col gap-3"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={quantityId}>Quantidade</Label>
          <NumericInput
            id={quantityId}
            aria-label={`Quantidade da leva de ${description}`}
            // Filled with the page's background: on the highlighted card a transparent field reads poorly.
            className="bg-background"
            {...form.register("quantity")}
          />
          {errors.quantity ? <p className="text-sm text-destructive">{errors.quantity.message}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={expiryId}>Validade (opcional)</Label>
          <Input
            id={expiryId}
            type="date"
            min={todayIso()}
            aria-label={`Validade da leva de ${description}`}
            className="bg-background"
            {...form.register("expiresAt")}
          />
          {errors.expiresAt ? <p className="text-sm text-destructive">{errors.expiresAt.message}</p> : null}
        </div>
      </div>

      <Failure message={failure} />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {existing ? "Lançar" : "Registrar leva"}
        </Button>
        {existing ? (
          <Button type="button" variant="outline" onClick={() => setSource("PRODUCED")}>
            Voltar
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => setSource("EXISTING")}>
            Lançar do que já existe
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onWeigh}>
          Pesar mais uma leva
        </Button>
      </div>
    </form>
  );
}

interface BatchesSectionProps {
  production: Production;
  item: ProductionItem;
  canRecord: boolean;
}

/** How far an item went, the levas that got it there and, to whoever may record, the way to add one. */
export function BatchesSection({ production, item, canRecord }: BatchesSectionProps) {
  const [weighing, setWeighing] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Progress item={item} />
      <BatchList production={production} item={item} canRecord={canRecord} />
      {canRecord ? <BatchForm production={production} item={item} onWeigh={() => setWeighing(true)} /> : null}
      {canRecord && weighing ? (
        <ItemWeighingPanel production={production} item={item} onDone={() => setWeighing(false)} />
      ) : null}
    </div>
  );
}
