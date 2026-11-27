"use client";

import { useCallback, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { planProductionItem, startProduction } from "@/features/productions/actions";
import { PLAN_MESSAGES } from "@/features/pre-weighings/produce";
import { FreeItemCard, produceOfPlan, type FreeItem } from "@/features/productions/FreeItemCard";
import { quantityOf } from "@/features/stock/stock-format";
import type { PreWeighingPlan, Product, StartCandidate, StartProductionBody } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { positiveDecimal } from "@/lib/form-schemas";
import { unitLabel } from "@/lib/units";
import { PageTitle } from "@/components/layout/PageTitle";
import { addReserved, reservedBy, type Reserved } from "@/shared/plan-reservation";

const itemFormSchema = z.object({
  productSku: z.string().min(1, "Escolha o produto."),
  quantity: positiveDecimal("Informe a quantidade, com até 6 casas decimais.", "A quantidade deve ser maior que zero."),
});

type ItemForm = z.infer<typeof itemFormSchema>;

const EMPTY_ITEM: ItemForm = { productSku: "", quantity: "" };

const START_MESSAGES = {
  404: "Uma pré-pesagem ou produto não existe mais. A lista foi atualizada.",
  409: "A pré-pesagem já foi usada em outra produção ou a receita mudou. A lista foi atualizada.",
};

type Mode = "guided" | "free";

const MODES: { value: Mode; label: string }[] = [
  { value: "guided", label: "Com pré-pesagem" },
  { value: "free", label: "Sem pré-pesagem" },
];

interface StartProductionPageProps {
  /** The active manufactured products: only those have a recipe to plan from. */
  products: Product[];
  /** The pending pre-weighings a production can start from, each with the stages under it. */
  candidates: StartCandidate[];
}

/** The stages under a root, listed as what they are: part of what the root starts, with nothing to choose. */
function StageList({ stages }: { stages: StartCandidate[] }) {
  if (stages.length === 0) return null;

  return (
    <ul className="ml-6 flex flex-col gap-1 border-l pl-3 text-sm">
      {stages.map((stage) => (
        <li key={stage.id}>
          {stage.product.description} — {quantityOf(stage.quantity, stage.product.unit)}
          <StageList stages={stage.stages} />
        </li>
      ))}
    </ul>
  );
}

/** What the items before `index` take of the stock of each intermediate, as their plans on screen stand. */
const reservedBefore = (items: FreeItem[], index: number): Reserved =>
  items.slice(0, index).reduce<Reserved>((sum, { plan }) => addReserved(sum, reservedBy(plan)), {});

export function StartProductionPage({ products, candidates }: StartProductionPageProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [freeItems, setFreeItems] = useState<FreeItem[]>([]);
  const [planFailure, setPlanFailure] = useState<string | null>(null);
  const [startFailure, setStartFailure] = useState<string | null>(null);
  const [planning, startPlanning] = useTransition();
  const [starting, startStarting] = useTransition();

  const form = useForm<ItemForm>({ resolver: zodResolver(itemFormSchema), defaultValues: EMPTY_ITEM });
  const { errors } = form.formState;

  // One root pre-weighing guides a production and free items make another one: each mode starts only its own.
  // A free item whose quantities to make are still being planned, or cannot be, holds the start back.
  const canStart =
    mode === "guided"
      ? chosen !== null
      : mode === "free" && freeItems.length > 0 && freeItems.every(({ busy }) => !busy);

  const changeItem = useCallback((key: number, change: { plan?: PreWeighingPlan; busy: boolean }) => {
    setFreeItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change, plan: change.plan ?? item.plan } : item)),
    );
  }, []);

  function choose(next: Mode): void {
    setMode(next);
    setChosen(null);
    setStartFailure(null);
  }

  function add(values: ItemForm): void {
    const quantity = toApiDecimal(values.quantity);
    // A new item goes below every other: it is planned against what all of them take of the stock.
    const reserved = reservedBefore(freeItems, freeItems.length);

    setPlanFailure(null);
    startPlanning(async () => {
      try {
        const result = await planProductionItem({ productSku: values.productSku, quantity }, undefined, reserved);

        if (!result.ok) {
          setPlanFailure(messageForFailure(result, PLAN_MESSAGES));
          return;
        }

        setFreeItems((current) => [
          ...current,
          {
            key: Math.max(0, ...current.map((item) => item.key)) + 1,
            quantity,
            plan: result.data,
            plannedAgainst: reserved,
            busy: false,
          },
        ]);
        form.reset(EMPTY_ITEM);
      } catch (error) {
        setPlanFailure(messageForFailure(error));
      }
    });
  }

  function start(): void {
    const body: StartProductionBody =
      mode === "guided" && chosen !== null
        ? { preWeighingId: chosen }
        : {
            // What starts is what was shown: every intermediate at the quantity the plan on screen makes.
            items: freeItems.map(({ plan, quantity }) => ({
              productSku: plan.product.sku,
              quantity,
              produce: produceOfPlan(plan),
            })),
          };

    setStartFailure(null);
    startStarting(async () => {
      try {
        const result = await startProduction(body);

        if (!result.ok) {
          setStartFailure(messageForFailure(result, START_MESSAGES));
          // What was chosen may be what someone else took: the operator picks again from a fresh list.
          setChosen(null);
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
      <PageTitle>Nova produção</PageTitle>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-lg font-semibold">Como produzir</legend>
        {MODES.map(({ value, label }) => (
          <div key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="production-mode"
              id={`mode-${value}`}
              checked={mode === value}
              onChange={() => choose(value)}
            />
            <Label htmlFor={`mode-${value}`} className="py-1.5">
              {label}
            </Label>
          </div>
        ))}
      </fieldset>

      {mode === "guided" ? (
        <section aria-labelledby="pending-pre-weighings" className="flex flex-col gap-3">
          <h2 id="pending-pre-weighings" className="text-lg font-semibold">
            Pré-pesagens pendentes
          </h2>

          {candidates.length === 0 ? <p>Nenhuma pré-pesagem pendente.</p> : null}

          <ul className="flex flex-col gap-3">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="start-candidate"
                    id={`pre-weighing-${candidate.id}`}
                    checked={chosen === candidate.id}
                    onChange={() => setChosen(candidate.id)}
                  />
                  <Label htmlFor={`pre-weighing-${candidate.id}`} className="flex-1 py-1.5">
                    {candidate.product.description} — {quantityOf(candidate.quantity, candidate.product.unit)} —{" "}
                    {formatDateTime(candidate.createdAt)}
                  </Label>
                </div>
                <StageList stages={candidate.stages} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mode === "free" ? (
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
            {freeItems.map((item, index) => (
              <FreeItemCard
                key={item.key}
                item={item}
                reserved={reservedBefore(freeItems, index)}
                onChange={changeItem}
                onRemove={(key) => setFreeItems((current) => current.filter((other) => other.key !== key))}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {startFailure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {startFailure}
        </p>
      ) : null}

      {mode !== null ? (
        <Button type="button" className="self-start" disabled={!canStart || starting} onClick={start}>
          Iniciar produção
        </Button>
      ) : null}
    </div>
  );
}
