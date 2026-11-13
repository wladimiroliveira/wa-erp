import { z } from "zod";
import type { MeasurementUnit } from "@/lib/api";
import { isDecimalInput, toApiDecimal } from "@/lib/decimal";
import { pickPlacesOf } from "@/shared/units";

/** A decimal typed by the operator that has to be above zero, with the wording of the field it is for. */
export const positiveDecimal = (missing: string, zero: string) =>
  z
    .string()
    .refine(isDecimalInput, missing)
    .refine((typed) => Number(toApiDecimal(typed)) > 0, zero);

/** Whether a decimal typed by the operator has no more places than a quantity of the unit is picked with. */
export const fitsPlacesOf = (typed: string, unit: MeasurementUnit): boolean =>
  isDecimalInput(typed) && (typed.split(",")[1]?.length ?? 0) <= pickPlacesOf(unit);
