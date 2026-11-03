"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { createLoss } from "@/features/losses/actions";
import type { LossReason, MeasurementUnit, StockLot } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { formatDecimal, isDecimalInput, toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { unitLabel } from "@/lib/units";

// The limit depends on the lot, so the schema is built for the lot at hand.
const lossFormSchema = (held: number) =>
  z.object({
    reasonId: z.string().min(1, "Escolha a modalidade."),
    quantity: z
      .string()
      .refine(isDecimalInput, "Informe a quantidade, com até 6 casas decimais.")
      .refine(
        (typed) => !isDecimalInput(typed) || Number(toApiDecimal(typed)) > 0,
        "A quantidade deve ser maior que zero.",
      )
      .refine(
        (typed) => !isDecimalInput(typed) || Number(toApiDecimal(typed)) <= held,
        "A quantidade não pode passar do saldo do lote.",
      ),
    note: z.string().trim().max(300, "A observação pode ter no máximo 300 caracteres."),
  });

type LossForm = z.infer<ReturnType<typeof lossFormSchema>>;

const EMPTY_FORM: LossForm = { reasonId: "", quantity: "", note: "" };

const SAVE_MESSAGES = {
  404: "O lote ou a modalidade já não existe mais. Atualize a página.",
  409: "O lote já não tem esse saldo ou a modalidade foi inativada. Atualize a página.",
};

interface LossDialogProps {
  /** The lot to write off. Null keeps the dialog closed. */
  lot: StockLot | null;
  unit: MeasurementUnit;
  productName: string;
  /** The reasons a loss may be recorded under, as the server read them. */
  reasons: LossReason[];
  onOpenChange: (open: boolean) => void;
}

export function LossDialog({ lot, unit, productName, reasons, onOpenChange }: LossDialogProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<LossForm>({
    resolver: zodResolver(lossFormSchema(Number(lot?.quantity ?? 0))),
    defaultValues: EMPTY_FORM,
  });

  // Opening the dialog for another lot must not show what was typed for the previous one.
  useEffect(() => {
    form.reset(EMPTY_FORM);
    setFailure(null);
  }, [form, lot?.id]);

  async function save({ reasonId, quantity, note }: LossForm): Promise<void> {
    setSaving(true);

    try {
      const result = await createLoss({
        lotId: lot?.id ?? "",
        reasonId,
        quantity: toApiDecimal(quantity),
        ...(note === "" ? {} : { note }),
      });

      if (!result.ok) {
        setFailure(messageForFailure(result, SAVE_MESSAGES));
        return;
      }

      toast.success("Avaria registrada.");
      onOpenChange(false);
      // The lot and the position changed on the server; the screen under the dialog reads them again.
      router.refresh();
    } catch (error) {
      setFailure(messageForFailure(error));
    } finally {
      setSaving(false);
    }
  }

  // A reason out of use is refused by the server, so it is never offered.
  const active = reasons.filter((reason) => reason.isActive);
  const { errors } = form.formState;

  return (
    <Dialog open={lot !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Avaria de lote</DialogTitle>
          {lot !== null ? (
            <DialogDescription>
              {productName} — lote{" "}
              {lot.expiresAt === null ? "sem validade" : `com validade ${formatDate(lot.expiresAt)}`} e saldo de{" "}
              {formatDecimal(lot.quantity)} {unitLabel(unit)}.
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((values) => {
            setFailure(null);
            return save(values);
          })}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-reason">Modalidade</Label>
            <NativeSelect id="loss-reason" {...form.register("reasonId")}>
              <option value="">Selecione a modalidade</option>
              {active.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.name}
                </option>
              ))}
            </NativeSelect>
            {errors.reasonId ? <p className="text-sm text-destructive">{errors.reasonId.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-quantity">Quantidade</Label>
            <NumericInput id="loss-quantity" trailing={unitLabel(unit)} {...form.register("quantity")} />
            {errors.quantity ? <p className="text-sm text-destructive">{errors.quantity.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="loss-note">Observação (opcional)</Label>
            <Input id="loss-note" autoComplete="off" {...form.register("note")} />
            {errors.note ? <p className="text-sm text-destructive">{errors.note.message}</p> : null}
          </div>

          {failure !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              Registrar avaria
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
