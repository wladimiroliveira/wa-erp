"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createPreWeighing, planPreWeighing, type PreWeighingTarget } from "@/features/pre-weighings/actions";
import { quantityOf } from "@/features/stock/stock-format";
import type { PreWeighing, PreWeighingPlan, Product } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { positiveDecimal } from "@/lib/form-schemas";
import { unitLabel } from "@/lib/units";
import { PageTitle } from "@/components/layout/PageTitle";

const targetFormSchema = z.object({
  productSku: z.string().min(1, "Escolha o produto."),
  quantity: positiveDecimal("Informe a quantidade, com até 6 casas decimais.", "A quantidade deve ser maior que zero."),
});

type TargetForm = z.infer<typeof targetFormSchema>;

const EMPTY_TARGET: TargetForm = { productSku: "", quantity: "" };

// One per ingredient of the plan, in the order of the plan.
const weighingFormSchema = z.object({
  items: z.array(
    z.object({
      weighedQuantity: positiveDecimal(
        "Informe o pesado, com até 6 casas decimais.",
        "O pesado deve ser maior que zero.",
      ),
    }),
  ),
});

type WeighingFormValues = z.infer<typeof weighingFormSchema>;

// Every refusal of the plan is the server having decided, so none of them is worth trying again as it is.
const PLAN_MESSAGES = {
  404: "Esse produto não existe mais. Atualize a página.",
  409: "Não foi possível calcular: o produto não tem receita, a receita usa um produto inativo ou a quantidade está fora do que a receita alcança.",
};

const SAVE_MESSAGES = {
  404: "Esse produto não existe mais. Atualize a página.",
  409: "A receita ou o produto mudou desde que o plano foi calculado. Calcule de novo.",
};

interface WeighingFormProps {
  target: PreWeighingTarget;
  plan: PreWeighingPlan;
  onRecorded: (preWeighing: PreWeighing) => void;
}

function WeighingForm({ target, plan, onRecorded }: WeighingFormProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const form = useForm<WeighingFormValues>({
    resolver: zodResolver(weighingFormSchema),
    // Blank on purpose: what gets recorded is what the scale showed, never the plan left untouched.
    defaultValues: { items: plan.items.map(() => ({ weighedQuantity: "" })) },
  });

  function save(body: Parameters<typeof createPreWeighing>[0]): void {
    startSaving(async () => {
      try {
        const result = await createPreWeighing(body);

        if (!result.ok) {
          setFailure(messageForFailure(result, SAVE_MESSAGES));
          return;
        }

        // The action already revalidated the list; refreshing brings the new record into the next visit.
        router.refresh();
        toast.success("Pré-pesagem registrada.");
        onRecorded(result.data);
      } catch (error) {
        setFailure(messageForFailure(error));
      }
    });
  }

  const { errors } = form.formState;

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        setFailure(null);
        save({
          ...target,
          items: plan.items.map(({ product }, index) => ({
            productSku: product.sku,
            weighedQuantity: toApiDecimal(values.items[index]!.weighedQuantity),
          })),
        });
      })}
      className="flex flex-col gap-4"
      noValidate
    >
      <h2 className="text-lg font-semibold">
        Plano para {quantityOf(plan.quantity, plan.product.unit)} de {plan.product.description}
      </h2>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ingrediente</TableHead>
            <TableHead>Planejado</TableHead>
            <TableHead>Lotes sugeridos</TableHead>
            <TableHead>Pesado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.items.map(({ product, plannedQuantity, lots, shortfall }, index) => (
            <TableRow key={product.sku}>
              <TableCell>{product.description}</TableCell>
              <TableCell>{quantityOf(plannedQuantity, product.unit)}</TableCell>
              <TableCell>
                {lots.length === 0 ? (
                  <p>Nenhum lote com saldo</p>
                ) : (
                  <ul>
                    {lots.map((lot) => (
                      <li key={lot.id}>
                        {quantityOf(lot.quantity, product.unit)} —{" "}
                        {lot.expiresAt === null ? "sem validade" : `validade ${formatDate(lot.expiresAt)}`}
                      </li>
                    ))}
                  </ul>
                )}
                {/* A warning, not a lock: the API records a pre-weighing the stock does not cover. */}
                {Number(shortfall) > 0 ? (
                  <p className="font-medium text-destructive">Faltam {quantityOf(shortfall, product.unit)}</p>
                ) : null}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <NumericInput
                    aria-label={`Pesado de ${product.description}`}
                    className="w-32"
                    {...form.register(`items.${index}.weighedQuantity`)}
                  />
                  <span>{unitLabel(product.unit)}</span>
                </div>
                {errors.items?.[index]?.weighedQuantity ? (
                  <p className="text-sm text-destructive">{errors.items[index].weighedQuantity.message}</p>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      <Button type="submit" disabled={saving} className="self-start">
        Registrar pré-pesagem
      </Button>
    </form>
  );
}

type Planned = { target: PreWeighingTarget; plan: PreWeighingPlan };

/** The active products that are manufactured: only those have a recipe to pre-weigh. The server page narrows the catalog to them. */
export function PreWeighingPage({ products: offered }: { products: Product[] }) {
  // The plan on screen, with the target it was asked for, and the number of the ask: each one
  // starts the weighing over. The lots come from the stock as it stands, so a plan is only asked
  // for when the operator asks: a refresh behind their back would move the rows they are typing into.
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [round, setRound] = useState(0);
  const [planFailure, setPlanFailure] = useState<string | null>(null);
  const [planning, startPlanning] = useTransition();
  const [recorded, setRecorded] = useState<PreWeighing | null>(null);

  const form = useForm<TargetForm>({ resolver: zodResolver(targetFormSchema), defaultValues: EMPTY_TARGET });

  function calculate(target: PreWeighingTarget): void {
    setRecorded(null);
    setPlanFailure(null);
    startPlanning(async () => {
      try {
        const result = await planPreWeighing(target);

        if (!result.ok) {
          setPlanned(null);
          setPlanFailure(messageForFailure(result, PLAN_MESSAGES));
          return;
        }

        setRound((current) => current + 1);
        setPlanned({ target, plan: result.data });
      } catch (error) {
        setPlanned(null);
        setPlanFailure(messageForFailure(error));
      }
    });
  }

  const { errors } = form.formState;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/pre-weighings" className="flex min-h-8 items-center self-start text-sm underline underline-offset-4">
        Voltar para as pré-pesagens
      </Link>

      <PageTitle>Nova pré-pesagem</PageTitle>

      {offered.length === 0 ? <p>Nenhum produto fabricado ativo cadastrado.</p> : null}

      {offered.length > 0 ? (
        <form
          onSubmit={form.handleSubmit((values) =>
            calculate({ productSku: values.productSku, quantity: toApiDecimal(values.quantity) }),
          )}
          className="flex max-w-md flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="pre-weighing-product">Produto</Label>
            <NativeSelect id="pre-weighing-product" {...form.register("productSku")}>
              <option value="">Selecione um produto</option>
              {offered.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {product.description} ({unitLabel(product.unit)})
                </option>
              ))}
            </NativeSelect>
            {errors.productSku ? <p className="text-sm text-destructive">{errors.productSku.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pre-weighing-quantity">Quantidade a produzir</Label>
            <NumericInput id="pre-weighing-quantity" {...form.register("quantity")} />
            {errors.quantity ? <p className="text-sm text-destructive">{errors.quantity.message}</p> : null}
          </div>

          <Button type="submit" variant="outline" disabled={planning} className="self-start">
            Calcular
          </Button>
        </form>
      ) : null}

      {planning ? <p>Calculando…</p> : null}

      {planFailure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {planFailure}
        </p>
      ) : null}

      {planned !== null ? (
        <WeighingForm
          key={round}
          target={planned.target}
          plan={planned.plan}
          onRecorded={(preWeighing) => {
            setRecorded(preWeighing);
            setPlanned(null);
            form.reset(EMPTY_TARGET);
          }}
        />
      ) : null}

      {recorded !== null ? (
        <div role="status" className="flex max-w-md flex-col gap-3 rounded-md border p-4">
          <p className="font-medium">
            Pré-pesagem registrada: {quantityOf(recorded.quantity, recorded.product.unit)} de{" "}
            {recorded.product.description}.
          </p>
          <Link
            href={`/pre-weighings/${recorded.id}`}
            className="flex min-h-8 items-center self-start underline underline-offset-4"
          >
            Ver a pré-pesagem
          </Link>
        </div>
      ) : null}
    </div>
  );
}
