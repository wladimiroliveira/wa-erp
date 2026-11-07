"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { loadMoreAvailablePreWeighings, planProductionItem, startProduction } from "@/features/productions/actions";
import { quantityOf } from "@/features/stock/stock-format";
import type { PreWeighing, PreWeighingPage, PreWeighingPlan, Product, StartProductionBody } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { positiveDecimal } from "@/lib/form-schemas";
import { unitLabel } from "@/lib/units";
import { PageTitle } from "@/components/layout/PageTitle";

const itemFormSchema = z.object({
  productSku: z.string().min(1, "Escolha o produto."),
  quantity: positiveDecimal("Informe a quantidade, com até 6 casas decimais.", "A quantidade deve ser maior que zero."),
});

type ItemForm = z.infer<typeof itemFormSchema>;

const EMPTY_ITEM: ItemForm = { productSku: "", quantity: "" };

// Every refusal of the plan is the server having decided, so none of them is worth trying again as it is.
const PLAN_MESSAGES = {
  404: "Esse produto não existe mais. Atualize a página.",
  409: "Não foi possível calcular: o produto não tem receita, a receita usa um produto inativo ou a quantidade está fora do que a receita alcança.",
};

const START_MESSAGES = {
  404: "Uma pré-pesagem ou produto não existe mais. A lista foi atualizada.",
  409: "Uma pré-pesagem já está em outra produção ou a receita mudou. A lista foi atualizada.",
};

/** An item produced without a pre-weighing: what was asked, and what the recipe plans for it. */
interface FreeItem {
  key: number;
  quantity: string;
  plan: PreWeighingPlan;
}

const lacks = (shortfall: string) => Number(shortfall) > 0;

interface StartProductionPageProps {
  /** The active manufactured products: only those have a recipe to plan from. */
  products: Product[];
  /** The first page of the pre-weighings no production uses yet. */
  preWeighings: PreWeighingPage;
}

export function StartProductionPage({ products, preWeighings }: StartProductionPageProps) {
  const router = useRouter();
  const [older, setOlder] = useState<{ items: PreWeighing[]; nextCursor: string | null } | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [freeItems, setFreeItems] = useState<FreeItem[]>([]);
  const [planFailure, setPlanFailure] = useState<string | null>(null);
  const [startFailure, setStartFailure] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [planning, startPlanning] = useTransition();
  const [starting, startStarting] = useTransition();

  const form = useForm<ItemForm>({ resolver: zodResolver(itemFormSchema), defaultValues: EMPTY_ITEM });
  const { errors } = form.formState;

  const available = [...preWeighings.items, ...(older?.items ?? [])];
  const nextCursor = older === null ? preWeighings.nextCursor : older.nextCursor;
  const isEmpty = checked.length === 0 && freeItems.length === 0;

  function toggle(id: string, on: boolean): void {
    setChecked((current) => (on ? [...current, id] : current.filter((other) => other !== id)));
  }

  function loadMore(cursor: string): void {
    startLoading(async () => {
      try {
        const result = await loadMoreAvailablePreWeighings(cursor);

        if (!result.ok) {
          toast.error(messageForFailure(result));
          return;
        }

        setOlder((current) => ({
          items: [...(current?.items ?? []), ...result.data.items],
          nextCursor: result.data.nextCursor,
        }));
      } catch (error) {
        toast.error(messageForFailure(error));
      }
    });
  }

  function add(values: ItemForm): void {
    const quantity = toApiDecimal(values.quantity);

    setPlanFailure(null);
    startPlanning(async () => {
      try {
        const result = await planProductionItem({ productSku: values.productSku, quantity });

        if (!result.ok) {
          setPlanFailure(messageForFailure(result, PLAN_MESSAGES));
          return;
        }

        setFreeItems((current) => [
          ...current,
          { key: Math.max(0, ...current.map((item) => item.key)) + 1, quantity, plan: result.data },
        ]);
        form.reset(EMPTY_ITEM);
      } catch (error) {
        setPlanFailure(messageForFailure(error));
      }
    });
  }

  function start(): void {
    // The pre-weighings in the order they are listed, then the items in the order they were added.
    const body: StartProductionBody = {
      items: [
        ...available.filter(({ id }) => checked.includes(id)).map(({ id }) => ({ preWeighingId: id })),
        ...freeItems.map(({ plan, quantity }) => ({ productSku: plan.product.sku, quantity })),
      ],
    };

    setStartFailure(null);
    startStarting(async () => {
      try {
        const result = await startProduction(body);

        if (!result.ok) {
          setStartFailure(messageForFailure(result, START_MESSAGES));
          // What was checked may be what someone else took: the operator picks again from a fresh list.
          // The pages loaded later go too: the refreshed first page may now hold some of them.
          setChecked([]);
          setOlder(null);
          router.refresh();
          return;
        }

        toast.success("Produção iniciada.");
        router.push(`/productions/${result.data.id}`);
      } catch (error) {
        setStartFailure(messageForFailure(error));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/productions" className="flex min-h-8 items-center self-start text-sm underline underline-offset-4">
        Voltar para as produções
      </Link>

      <PageTitle>Nova produção</PageTitle>

      <section aria-labelledby="available-pre-weighings" className="flex flex-col gap-3">
        <h2 id="available-pre-weighings" className="text-lg font-semibold">
          Pré-pesagens disponíveis
        </h2>

        {available.length === 0 ? <p>Nenhuma pré-pesagem disponível.</p> : null}

        <ul className="flex flex-col gap-1">
          {available.map((preWeighing) => (
            <li key={preWeighing.id} className="flex items-center gap-2">
              <Checkbox
                id={`pre-weighing-${preWeighing.id}`}
                checked={checked.includes(preWeighing.id)}
                onCheckedChange={(on) => toggle(preWeighing.id, on === true)}
              />
              <Label htmlFor={`pre-weighing-${preWeighing.id}`} className="flex-1 py-1.5">
                {preWeighing.product.description} — {quantityOf(preWeighing.quantity, preWeighing.product.unit)} —{" "}
                {formatDateTime(preWeighing.createdAt)}
              </Label>
            </li>
          ))}
        </ul>

        {nextCursor !== null ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={loading}
            onClick={() => loadMore(nextCursor)}
          >
            Carregar mais
          </Button>
        ) : null}
      </section>

      <section aria-labelledby="free-items" className="flex flex-col gap-3">
        <h2 id="free-items" className="text-lg font-semibold">
          Itens sem pré-pesagem
        </h2>

        {products.length === 0 ? <p>Nenhum produto fabricado ativo cadastrado.</p> : null}

        {products.length > 0 ? (
          <form onSubmit={form.handleSubmit(add)} className="flex max-w-md flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="production-product">Produto</Label>
              <NativeSelect id="production-product" {...form.register("productSku")}>
                <option value="">Selecione um produto</option>
                {products.map((product) => (
                  <option key={product.sku} value={product.sku}>
                    {product.description} ({unitLabel(product.unit)})
                  </option>
                ))}
              </NativeSelect>
              {errors.productSku ? <p className="text-sm text-destructive">{errors.productSku.message}</p> : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="production-quantity">Quantidade a produzir</Label>
              <NumericInput id="production-quantity" {...form.register("quantity")} />
              {errors.quantity ? <p className="text-sm text-destructive">{errors.quantity.message}</p> : null}
            </div>

            <Button type="submit" variant="outline" disabled={planning} className="self-start">
              Adicionar
            </Button>
          </form>
        ) : null}

        {planFailure !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {planFailure}
          </p>
        ) : null}

        <ul className="flex flex-col gap-3">
          {freeItems.map(({ key, quantity, plan }) => (
            <li key={key} className="flex flex-col gap-2 rounded-md border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {plan.product.description} — {quantityOf(quantity, plan.product.unit)}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remover ${plan.product.description}`}
                  onClick={() => setFreeItems((current) => current.filter((item) => item.key !== key))}
                >
                  Remover
                </Button>
              </div>
              <ul className="text-sm">
                {plan.items.map((input) => (
                  <li key={input.product.sku}>
                    {input.product.description}: {quantityOf(input.plannedQuantity, input.product.unit)}
                  </li>
                ))}
              </ul>
              {plan.items
                .filter((input) => lacks(input.shortfall))
                .map((input) => (
                  <p key={input.product.sku} className="text-sm text-destructive">
                    Estoque insuficiente: falta {quantityOf(input.shortfall, input.product.unit)} de{" "}
                    {input.product.description}
                  </p>
                ))}
            </li>
          ))}
        </ul>
      </section>

      {startFailure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {startFailure}
        </p>
      ) : null}

      <Button type="button" className="self-start" disabled={isEmpty || starting} onClick={start}>
        Iniciar produção
      </Button>
    </div>
  );
}
