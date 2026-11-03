"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { DeficitDialog } from "@/features/entries/DeficitDialog";
import { createEntry, type CreateEntryResult } from "@/features/entries/actions";
import type { CreateEntryBody, Entry, Product, Supplier } from "@/lib/api";
import { formatDate, todayIso } from "@/lib/dates";
import { formatDecimal, formatMoney, isDecimalInput, toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { unitLabel } from "@/lib/units";
import { PageTitle } from "@/components/layout/PageTitle";

const entryFormSchema = z
  .object({
    productSku: z.string().min(1, "Escolha o produto."),
    quantity: z
      .string()
      .refine(isDecimalInput, "Informe a quantidade, com até 6 casas decimais.")
      .refine((typed) => Number(toApiDecimal(typed)) > 0, "A quantidade deve ser maior que zero."),
    unitCost: z.string().refine(isDecimalInput, "Informe o custo unitário, com até 6 casas decimais."),
    expiresAt: z.string(),
    noExpiry: z.boolean(),
    supplierId: z.string(),
  })
  // A lot with no expiry is something the operator says, never something a blank field implies.
  .refine((entry) => entry.noExpiry || entry.expiresAt !== "", {
    path: ["expiresAt"],
    message: 'Informe a validade ou marque "Sem data de validade".',
  })
  .refine((entry) => entry.noExpiry || entry.expiresAt === "" || entry.expiresAt >= todayIso(), {
    path: ["expiresAt"],
    message: "A validade não pode ser anterior a hoje.",
  });

type EntryForm = z.infer<typeof entryFormSchema>;

const EMPTY_FORM: EntryForm = {
  productSku: "",
  quantity: "",
  unitCost: "",
  expiresAt: "",
  noExpiry: false,
  supplierId: "",
};

const SAVE_MESSAGES = {
  404: "O produto ou o fornecedor já não existe mais. Atualize a página.",
  409: "Esse produto está inativo e não recebe entradas.",
};

function toBody(values: EntryForm): CreateEntryBody {
  return {
    productSku: values.productSku,
    quantity: toApiDecimal(values.quantity),
    unitCost: toApiDecimal(values.unitCost),
    expiresAt: values.noExpiry ? null : values.expiresAt,
    ...(values.supplierId === "" ? {} : { supplierId: values.supplierId }),
  };
}

/** The 409 that carries `deficit` is the negative balance waiting to be settled, not a refusal. */
function deficitOf(result: CreateEntryResult): string | null {
  if (result.ok || result.status !== 409 || !("deficit" in result)) return null;

  return typeof result.deficit === "string" ? result.deficit : null;
}

interface EntryPageProps {
  /** The catalog as the server read it. */
  products: Product[];
  suppliers: Supplier[];
}

export function EntryPage({ products, suppliers }: EntryPageProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recorded, setRecorded] = useState<Entry | null>(null);
  const [unsettled, setUnsettled] = useState<{ body: CreateEntryBody; deficit: string } | null>(null);

  const form = useForm<EntryForm>({ resolver: zodResolver(entryFormSchema), defaultValues: EMPTY_FORM });
  const noExpiry = form.watch("noExpiry");
  const chosenSku = form.watch("productSku");

  async function save(body: CreateEntryBody): Promise<void> {
    setSaving(true);

    try {
      const result = await createEntry(body);

      if (result.ok) {
        setRecorded(result.data);
        toast.success("Entrada lançada.");
        form.reset(EMPTY_FORM);
        return;
      }

      const deficit = deficitOf(result);

      if (deficit !== null) setUnsettled({ body, deficit });
      else setFailure(messageForFailure(result, SAVE_MESSAGES));
    } catch (error) {
      setFailure(messageForFailure(error));
    } finally {
      setSaving(false);
    }
  }

  // An inactive product is refused by the server, so it is never offered.
  const active = products.filter((product) => product.isActive);
  const chosen = active.find(({ sku }) => sku === chosenSku);
  const chosenUnit = chosen === undefined ? undefined : unitLabel(chosen.unit);
  const owing = active.find((product) => product.sku === unsettled?.body.productSku);

  const { errors } = form.formState;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <PageTitle>Entradas</PageTitle>

      {active.length === 0 ? <p>Nenhum produto ativo cadastrado.</p> : null}

      {active.length > 0 ? (
        <form
          onSubmit={form.handleSubmit((values) => {
            setFailure(null);
            return save(toBody(values));
          })}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-product">Produto</Label>
            <NativeSelect id="entry-product" {...form.register("productSku")}>
              <option value="">Selecione um produto</option>
              {active.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {product.description} ({unitLabel(product.unit)})
                </option>
              ))}
            </NativeSelect>
            {errors.productSku ? <p className="text-sm text-destructive">{errors.productSku.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-quantity">Quantidade</Label>
            <NumericInput id="entry-quantity" trailing={chosenUnit} {...form.register("quantity")} />
            {errors.quantity ? <p className="text-sm text-destructive">{errors.quantity.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-unit-cost">Custo unitário</Label>
            <NumericInput id="entry-unit-cost" leading="R$" minFractionDigits={2} {...form.register("unitCost")} />
            {errors.unitCost ? <p className="text-sm text-destructive">{errors.unitCost.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-expires-at">Validade</Label>
            <Input
              id="entry-expires-at"
              type="date"
              min={todayIso()}
              disabled={noExpiry}
              {...form.register("expiresAt")}
            />
            <div className="flex min-h-8 items-center gap-2">
              <Checkbox
                id="entry-no-expiry"
                checked={noExpiry}
                onCheckedChange={(checked) => {
                  form.setValue("noExpiry", checked === true);
                  form.setValue("expiresAt", "", { shouldValidate: form.formState.isSubmitted });
                }}
              />
              <Label htmlFor="entry-no-expiry" className="py-1.5">
                Sem data de validade
              </Label>
            </div>
            {errors.expiresAt ? <p className="text-sm text-destructive">{errors.expiresAt.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-supplier">Fornecedor (opcional)</Label>
            <NativeSelect id="entry-supplier" {...form.register("supplierId")}>
              <option value="">Sem fornecedor</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          {failure !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}

          <Button type="submit" disabled={saving} className="self-start">
            Lançar entrada
          </Button>
        </form>
      ) : null}

      {recorded !== null ? (
        <div role="status" className="flex flex-col gap-3 rounded-md border p-4">
          <p className="font-medium">
            Entrada lançada: {formatDecimal(recorded.quantity)} {unitLabel(recorded.product.unit)} de{" "}
            {recorded.product.description}.
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Validade do lote</dt>
            <dd>{recorded.lot.expiresAt === null ? "Sem validade" : formatDate(recorded.lot.expiresAt)}</dd>
            <dt className="text-muted-foreground">Fornecedor</dt>
            <dd>{recorded.lot.supplier?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Saldo do lote</dt>
            <dd>
              {formatDecimal(recorded.lot.quantity)} {unitLabel(recorded.product.unit)}
            </dd>
            <dt className="text-muted-foreground">Estoque atual</dt>
            <dd>
              {formatDecimal(recorded.stock.quantity)} {unitLabel(recorded.product.unit)}
            </dd>
            <dt className="text-muted-foreground">Último custo</dt>
            <dd>{formatMoney(recorded.stock.lastEntryCost)}</dd>
            <dt className="text-muted-foreground">Custo médio</dt>
            <dd>{formatMoney(recorded.stock.averageCost)}</dd>
          </dl>
        </div>
      ) : null}

      <DeficitDialog
        owed={
          unsettled !== null && owing !== undefined
            ? `${owing.description} está com o estoque negativo em ${formatDecimal(unsettled.deficit)} ${unitLabel(owing.unit)}`
            : null
        }
        onCancel={() => setUnsettled(null)}
        onSettle={(deficit) => {
          if (unsettled === null) return;

          setUnsettled(null);
          void save({ ...unsettled.body, deficit });
        }}
      />
    </div>
  );
}
