import { z } from "zod";
import { isDecimalInput, toApiDecimal } from "@/lib/decimal";

/** A decimal typed by the operator that has to be above zero, with the wording of the field it is for. */
export const positiveDecimal = (missing: string, zero: string) =>
  z
    .string()
    .refine(isDecimalInput, missing)
    .refine((typed) => Number(toApiDecimal(typed)) > 0, zero);
