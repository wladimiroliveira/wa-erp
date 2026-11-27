import type { MeasurementUnit } from "@/lib/api";
import { isDecimalInput, toApiDecimal } from "@/lib/decimal";
import { fitsPlacesOf } from "@/lib/form-schemas";
import { pickPlacesOf } from "@/shared/units";

// How much to make of an intermediate, as typed on a plan, and what a refused plan means: shared by
// every screen that asks for a plan.

// Every refusal of the plan is the server having decided, so none of them is worth trying again as it is.
export const PLAN_MESSAGES = {
  404: "Esse produto não existe mais. Atualize a página.",
  409: "Não foi possível calcular: o produto não tem receita, a receita usa um produto inativo ou a quantidade está fora do que a receita alcança.",
};

/** How long the operator may pause in a quantity to make before the plan is asked again. */
export const REPLAN_DELAY_MS = 500;

/** Why a quantity to make cannot be asked for: zero is fine, it takes it all from stock. */
export function produceProblem(typed: string, unit: MeasurementUnit): string | undefined {
  const places = pickPlacesOf(unit);
  const message =
    places === 0 ? "Informe uma quantidade inteira." : `Informe a quantidade, com até ${places} casas decimais.`;

  return fitsPlacesOf(typed, unit) ? undefined : message;
}

/** The quantities to make typed so far, by SKU, as the API takes them; what is not yet a number is left out. */
export const produceOf = (typed: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(typed)
      .filter(([, quantity]) => isDecimalInput(quantity))
      .map(([sku, quantity]) => [sku, toApiDecimal(quantity)]),
  );
