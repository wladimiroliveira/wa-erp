"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import { createPreWeighing, planPreWeighing, type PreWeighingTarget } from "@/features/pre-weighings/actions";
import { quantityOf } from "@/features/stock/stock-format";
import { WEIGHING_PLACES } from "@/features/pre-weighings/weighing-units";
import { WasteSection } from "@/features/pre-weighings/WasteSection";
import { createBodyOf, weighingRowsOf } from "@/features/pre-weighings/plan-tree";
import {
  PreWeighingStage,
  rowKeyOf,
  type StageProduce,
  type StageWeighing,
} from "@/features/pre-weighings/PreWeighingStage";
import type { CreatePreWeighingBody, MeasurementUnit, PreWeighing, PreWeighingPlan, Product } from "@/lib/api";
import { formatDecimal, isDecimalInput, toApiDecimal } from "@/lib/decimal";
import { messageForFailure } from "@/lib/form-errors";
import { fitsPlacesOf, positiveDecimal } from "@/lib/form-schemas";
import { unitLabel } from "@/lib/units";
import { PageTitle } from "@/components/layout/PageTitle";
import { convert, pickPlacesOf, readableQuantity } from "@/shared/units";

const targetFormSchema = z.object({
  productSku: z.string().min(1, "Escolha o produto."),
  quantity: positiveDecimal("Informe a quantidade, com até 6 casas decimais.", "A quantidade deve ser maior que zero."),
  // How much more than asked for may be produced to leave less behind of what cannot be kept.
  tolerance: z
    .string()
    .refine((typed) => /^\d{1,3}$/.test(typed) && Number(typed) <= 100, "Informe um número inteiro de 0 a 100."),
});

type TargetForm = z.infer<typeof targetFormSchema>;

const EMPTY_TARGET: TargetForm = { productSku: "", quantity: "", tolerance: "20" };

const WEIGHED_MESSAGE = `Informe o pesado, com até ${WEIGHING_PLACES} casas decimais.`;

// Typed in the unit the row shows, with the places a scale shows. A line a re-plan brought in has no value yet.
const weighedSchema = z.preprocess(
  (typed) => typed ?? "",
  positiveDecimal(WEIGHED_MESSAGE, "O pesado deve ser maior que zero.").refine(
    (typed) => (typed.split(",")[1]?.length ?? 0) <= WEIGHING_PLACES,
    WEIGHED_MESSAGE,
  ),
);

// One per line to weigh of the plan, by its key in the tree: only the lines of the plan on screen count.
const weighingSchemaOf = (keys: string[]) =>
  z.object({ weighed: z.object(Object.fromEntries(keys.map((key) => [key, weighedSchema]))) });

type WeighingFormValues = { weighed: Record<string, string> };

// How long the operator may pause in the quantity to make before the plan is asked again.
const REPLAN_DELAY_MS = 500;

/** Why a quantity to make cannot be asked for: zero is fine, it takes it all from stock. */
function produceProblem(typed: string, unit: MeasurementUnit): string | undefined {
  const places = pickPlacesOf(unit);
  const message =
    places === 0 ? "Informe uma quantidade inteira." : `Informe a quantidade, com até ${places} casas decimais.`;

  return fitsPlacesOf(typed, unit) ? undefined : message;
}

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
  /** The pre-weighing this one complements, if any. */
  parentId?: string;
  produce: StageProduce;
  onRecorded: (preWeighing: PreWeighing) => void;
}

function WeighingForm({ target, plan, parentId, produce, onRecorded }: WeighingFormProps) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const rows = weighingRowsOf(plan);
  const keys = rows.map(({ path, product }) => rowKeyOf(path, product.sku));
  // The resolver reads the lines of the plan on screen, which a re-plan replaces without a new form.
  const keysRef = useRef(keys);
  useEffect(() => {
    keysRef.current = keys;
  });

  const form = useForm<WeighingFormValues>({
    resolver: (values, context, options) =>
      (zodResolver(weighingSchemaOf(keysRef.current)) as unknown as Resolver<WeighingFormValues>)(
        values,
        context,
        options,
      ),
    // Blank on purpose: what gets recorded is what the scale showed, never the plan left untouched.
    defaultValues: { weighed: Object.fromEntries(keys.map((key) => [key, ""])) },
  });

  // The unit each line is weighed in once the operator chose it or typed in it; until then, the one its plan reads best in.
  const [units, setUnits] = useState<Record<string, MeasurementUnit>>({});

  const unitOf = (key: string, product: { unit: MeasurementUnit }, plannedQuantity: string): MeasurementUnit =>
    units[key] ?? readableQuantity(plannedQuantity, product.unit).unit;

  // What was already weighed is carried into the new unit, so the number on screen keeps meaning the same amount.
  function chooseUnit(key: string, unit: MeasurementUnit): void {
    const row = rows[keys.indexOf(key)]!;
    const field = `weighed.${key}` as const;
    const typed = form.getValues(field) ?? "";
    const shown = unitOf(key, row.product, row.plannedQuantity);

    if (isDecimalInput(typed)) form.setValue(field, formatDecimal(convert(toApiDecimal(typed), shown, unit)));

    setUnits((current) => ({ ...current, [key]: unit }));
  }

  const weighing: StageWeighing = {
    register: (key) => {
      const registered = form.register(`weighed.${key}`);
      const row = rows[keys.indexOf(key)]!;

      return {
        ...registered,
        // A number typed stays in the unit it was typed in, even if a re-plan would read the line better in another.
        onChange: async (event) => {
          const unit = unitOf(key, row.product, row.plannedQuantity);
          setUnits((current) => (key in current ? current : { ...current, [key]: unit }));

          return registered.onChange(event);
        },
      };
    },
    error: (key) => form.formState.errors.weighed?.[key]?.message,
    unitOf,
    chooseUnit,
  };

  function save(body: CreatePreWeighingBody): void {
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

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        setFailure(null);
        const weighed = rows.map((row, index) =>
          convert(
            toApiDecimal(values.weighed[keys[index]!]!),
            unitOf(keys[index]!, row.product, row.plannedQuantity),
            row.product.unit,
          ),
        );
        // The root is what was asked for; the plan echoes it.
        save({ ...createBodyOf(plan, weighed, parentId), ...target });
      })}
      className="flex flex-col gap-4"
      noValidate
    >
      <PreWeighingStage plan={plan} weighing={weighing} produce={produce} />

      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      <Button type="submit" disabled={saving || produce.disabled} className="self-start">
        Registrar pré-pesagem
      </Button>
    </form>
  );
}

type Planned = { target: PreWeighingTarget; tolerance: number; plan: PreWeighingPlan };

/** A pre-weighing recorded under one that exists: what a shortage at the finish of a production asks for. */
export interface PreWeighingComplement {
  parentId: string;
  /** The product of the pre-weighing complemented. */
  parentDescription: string;
  productSku: string;
  /** In the unit of the product, as the API writes it. */
  quantity: string;
}

const sameComplement = (one: PreWeighingComplement, other: PreWeighingComplement | null): boolean =>
  other !== null &&
  one.parentId === other.parentId &&
  one.productSku === other.productSku &&
  one.quantity === other.quantity;

/** The target of a complement as the form shows it; anything else starts blank. */
const targetOf = (complement?: PreWeighingComplement): TargetForm =>
  complement
    ? { ...EMPTY_TARGET, productSku: complement.productSku, quantity: formatDecimal(complement.quantity) }
    : EMPTY_TARGET;

/** The quantities to make the operator typed, as the API takes them; those not yet a quantity are left to the server. */
const produceOf = (typed: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(typed)
      .filter(([, quantity]) => isDecimalInput(quantity))
      .map(([sku, quantity]) => [sku, toApiDecimal(quantity)]),
  );

/**
 * The active products that are manufactured: only those have a recipe to pre-weigh. The server page narrows the
 * catalog to them. With `complement`, the target is the one asked for and the record goes under the parent.
 */
export function PreWeighingPage({
  products: offered,
  complement: asked,
}: {
  products: Product[];
  complement?: PreWeighingComplement;
}) {
  // The plan on screen, with the target it was asked for, and the number of the ask: each one
  // starts the weighing over. The lots come from the stock as it stands, so a plan is only asked
  // for when the operator asks: a refresh behind their back would move the rows they are typing into.
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [round, setRound] = useState(0);
  const [planFailure, setPlanFailure] = useState<string | null>(null);
  const [planning, startPlanning] = useTransition();
  const [recorded, setRecorded] = useState<PreWeighing | null>(null);
  // How much to make of each intermediate, as typed, by SKU: only those the operator touched; the rest is the server's default.
  const [produceTyped, setProduceTyped] = useState<Record<string, string>>({});
  const [produceErrors, setProduceErrors] = useState<Record<string, string>>({});
  // The plan to ask once the operator pauses in a quantity to make; a newer one, or a fresh plan, calls it off.
  const [replan, setReplan] = useState<{
    target: PreWeighingTarget;
    tolerance: number;
    produce: Record<string, string>;
  } | null>(null);

  // The number of the latest ask: an answer to an older one arrives too late to be shown.
  const latestAsk = useRef(0);
  // A complement once recorded is over: the screen goes on as a new pre-weighing, so it cannot be
  // recorded twice, until the address it came from is left.
  const [recordedComplement, setRecordedComplement] = useState<PreWeighingComplement | null>(null);
  if (asked === undefined && recordedComplement !== null) setRecordedComplement(null);
  const complement = asked !== undefined && !sameComplement(asked, recordedComplement) ? asked : undefined;

  const router = useRouter();
  const form = useForm<TargetForm>({ resolver: zodResolver(targetFormSchema), defaultValues: targetOf(complement) });

  /** Asks the plan; `fresh` starts the weighing over, otherwise the lines the new plan still has keep what was typed. */
  const calculate = useCallback(function calculate(
    target: PreWeighingTarget,
    tolerance: number,
    produce: Record<string, string>,
    fresh: boolean,
  ): void {
    const ask = ++latestAsk.current;
    setReplan(null);
    setRecorded(null);
    setPlanFailure(null);
    startPlanning(async () => {
      try {
        const result =
          Object.keys(produce).length === 0
            ? await planPreWeighing(target, tolerance)
            : await planPreWeighing(target, tolerance, produce);

        if (ask !== latestAsk.current) return;

        if (!result.ok) {
          // A re-plan that fails leaves the plan on screen, and what was weighed in it, as it was.
          if (fresh) setPlanned(null);
          setPlanFailure(messageForFailure(result, PLAN_MESSAGES));
          return;
        }

        if (fresh) setRound((current) => current + 1);
        setPlanned({ target, tolerance, plan: result.data });
      } catch (error) {
        if (ask !== latestAsk.current) return;
        if (fresh) setPlanned(null);
        setPlanFailure(messageForFailure(error));
      }
    });
  }, []);

  useEffect(() => {
    if (replan === null) return;

    const timer = setTimeout(() => calculate(replan.target, replan.tolerance, replan.produce, false), REPLAN_DELAY_MS);

    return () => clearTimeout(timer);
  }, [replan, calculate]);

  const produce: StageProduce = {
    typed: (sku) => produceTyped[sku],
    error: (sku) => produceErrors[sku],
    // Also while a quantity typed waits to be planned: the plan on screen is about to change.
    disabled: planning || replan !== null,
    // Asked again once the operator pauses, as long as what was typed is a quantity.
    change: (sku, unit, typed) => {
      const next = { ...produceTyped, [sku]: typed };
      const problem = produceProblem(typed, unit);
      setProduceTyped(next);
      setProduceErrors((current) => {
        const others = Object.fromEntries(Object.entries(current).filter(([shown]) => shown !== sku));

        return problem === undefined ? others : { ...others, [sku]: problem };
      });

      if (problem !== undefined || planned === null) {
        setReplan(null);
        return;
      }

      setReplan({ target: planned.target, tolerance: planned.tolerance, produce: produceOf(next) });
    },
  };

  const { errors } = form.formState;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/pre-weighings" className="flex min-h-8 items-center self-start text-sm underline underline-offset-4">
        Voltar para as pré-pesagens
      </Link>

      <PageTitle>Nova pré-pesagem</PageTitle>

      {complement ? <p className="font-medium">Complemento da pré-pesagem de {complement.parentDescription}</p> : null}

      {offered.length === 0 ? <p>Nenhum produto fabricado ativo cadastrado.</p> : null}

      {offered.length > 0 ? (
        <form
          // Wrapped so that the form is read on submit, not while rendering: `calculate` keeps the number of the latest ask.
          onSubmit={(event) =>
            form.handleSubmit((values) => {
              // A new target starts from the server's own quantities to make.
              setProduceTyped({});
              setProduceErrors({});
              calculate(
                // A complement makes what was asked for: its target is not the operator's to change.
                complement
                  ? { productSku: complement.productSku, quantity: complement.quantity }
                  : { productSku: values.productSku, quantity: toApiDecimal(values.quantity) },
                Number(values.tolerance),
                {},
                true,
              );
            })(event)
          }
          className="flex max-w-md flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="pre-weighing-product">Produto</Label>
            <NativeSelect
              id="pre-weighing-product"
              disabled={complement !== undefined}
              {...form.register("productSku")}
            >
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
            <NumericInput
              id="pre-weighing-quantity"
              readOnly={complement !== undefined}
              {...form.register("quantity")}
            />
            {errors.quantity ? <p className="text-sm text-destructive">{errors.quantity.message}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pre-weighing-tolerance">Aceitar até (%)</Label>
            <NumericInput
              id="pre-weighing-tolerance"
              className="w-32"
              format="digits"
              maxLength={3}
              trailing="%"
              {...form.register("tolerance")}
            />
            {errors.tolerance ? <p className="text-sm text-destructive">{errors.tolerance.message}</p> : null}
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

      {planned !== null && planned.plan.waste !== null ? (
        <WasteSection
          waste={planned.plan.waste}
          unit={planned.plan.product.unit}
          // A complement makes what was asked for, no more.
          disabled={planning || complement !== undefined}
          // The fields show what is calculated: the plan's product and tolerance, with the quantity suggested.
          // The quantities to make the operator chose still hold for the same product.
          onProduce={(quantity) => {
            form.setValue("productSku", planned.target.productSku);
            form.setValue("quantity", formatDecimal(quantity));
            form.setValue("tolerance", String(planned.tolerance));
            calculate(
              { productSku: planned.target.productSku, quantity },
              planned.tolerance,
              produceOf(produceTyped),
              true,
            );
          }}
        />
      ) : null}

      {planned !== null ? (
        <WeighingForm
          key={round}
          target={planned.target}
          plan={planned.plan}
          parentId={complement?.parentId}
          produce={produce}
          onRecorded={(preWeighing) => {
            // Nothing asked before the record may bring its plan back.
            latestAsk.current += 1;
            setReplan(null);
            setRecorded(preWeighing);
            setPlanned(null);
            setProduceTyped({});
            setProduceErrors({});

            if (complement !== undefined) {
              setRecordedComplement(complement);
              router.replace("/pre-weighings/new");
            }

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
