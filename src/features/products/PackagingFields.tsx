"use client";

import { useEffect } from "react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { NumericInput } from "@/components/ui/numeric-input";
import type { MeasurementUnit, Packaging } from "@/lib/api";
import { toApiDecimal, toDecimalInput } from "@/lib/decimal";
import { positiveDecimal } from "@/lib/form-schemas";
import { UNITS, unitLabel } from "@/lib/units";
import { hasValidCheckDigit } from "@/shared/gtin";
import { compatibleUnits, readableQuantity } from "@/shared/units";

export const gtinField = z
  .string()
  .trim()
  .refine((typed) => typed === "" || /^\d{8,14}$/.test(typed), "O GTIN tem de 8 a 14 dígitos, só números.")
  .refine(
    (typed) => !/^\d{8,14}$/.test(typed) || hasValidCheckDigit(typed),
    "O dígito verificador do GTIN não confere. Revise o código.",
  );

const packagingRowSchema = z.object({
  // Present on a stored packaging only.
  id: z.string().optional(),
  content: positiveDecimal("Informe o conteúdo da embalagem.", "O conteúdo tem de ser maior que zero."),
  unit: z.enum(UNITS),
  gtin: gtinField,
  isActive: z.boolean(),
});

export const packagingRowsSchema = z.array(packagingRowSchema).refine((rows) => {
  const gtins = rows.map(({ gtin }) => gtin.trim()).filter((gtin) => gtin !== "");

  return new Set(gtins).size === gtins.length;
}, "Cada GTIN só pode aparecer em uma embalagem.");

export type PackagingRow = z.infer<typeof packagingRowSchema>;

/** A stored packaging as its row shows it, in the unit that reads best: 0.38 kg becomes 380 g. */
export function rowOf(packaging: Packaging, unit: MeasurementUnit): PackagingRow {
  const readable = readableQuantity(packaging.content, unit);

  return {
    id: packaging.id,
    content: toDecimalInput(readable.quantity),
    unit: readable.unit,
    gtin: packaging.gtin ?? "",
    isActive: packaging.isActive,
  };
}

/** What a new product sends of each row: a blank GTIN is left out. */
export const toCreatedPackaging = ({ content, unit, gtin }: PackagingRow) => ({
  content: toApiDecimal(content),
  unit,
  ...(gtin === "" ? {} : { gtin }),
});

/** What an edit sends of each row: the whole list, a blank GTIN as null so that erasing it sticks. */
export const toEditedPackaging = ({ id, content, unit, gtin, isActive }: PackagingRow) => ({
  ...(id === undefined ? {} : { id }),
  content: toApiDecimal(content),
  unit,
  gtin: gtin === "" ? null : gtin,
  isActive,
});

type FormWithPackagings = { packagings: PackagingRow[] };

interface PackagingFieldsProps<Form extends FormWithPackagings> {
  control: Control<Form>;
  register: UseFormRegister<Form>;
  setValue: UseFormSetValue<Form>;
  errors: FieldErrors<Form>;
  /** The product's unit; none yet while a new product has not chosen it. */
  unit: MeasurementUnit | undefined;
}

/** The packagings of a product, edited with it and saved by the form that holds them. */
export function PackagingFields<Form extends FormWithPackagings>(props: PackagingFieldsProps<Form>) {
  // The generic form narrowed to the part this section owns.
  const { control, register, setValue, errors, unit } = props as unknown as PackagingFieldsProps<FormWithPackagings>;
  const rows = useFieldArray({ control, name: "packagings" });
  const typed = useWatch({ control, name: "packagings" });
  const offered = unit === undefined ? [] : compatibleUnits(unit);

  // A unit of another dimension stops measuring the product: the row follows the product's unit.
  useEffect(() => {
    if (unit === undefined) return;

    typed?.forEach((row, index) => {
      if (!compatibleUnits(unit).includes(row.unit)) setValue(`packagings.${index}.unit`, unit);
    });
  }, [unit, typed, setValue]);

  const listError = errors.packagings?.root?.message ?? errors.packagings?.message;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">Embalagens</legend>

      {rows.fields.map((row, index) => {
        const position = index + 1;
        const rowErrors = errors.packagings?.[index];
        const stored = typed?.[index]?.id !== undefined;
        const active = typed?.[index]?.isActive ?? true;

        return (
          <div key={row.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <NumericInput
                aria-label={`Conteúdo da embalagem ${position}`}
                className="w-28"
                {...register(`packagings.${index}.content`)}
              />
              <NativeSelect
                aria-label={`Unidade da embalagem ${position}`}
                className="w-20"
                {...register(`packagings.${index}.unit`)}
              >
                {offered.map((option) => (
                  <option key={option} value={option}>
                    {unitLabel(option)}
                  </option>
                ))}
              </NativeSelect>
              <NumericInput
                aria-label={`GTIN da embalagem ${position}`}
                placeholder="GTIN (opcional)"
                className="w-44"
                format="digits"
                maxLength={14}
                {...register(`packagings.${index}.gtin`)}
              />
              {stored ? (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`${active ? "Inativar" : "Reativar"} embalagem ${position}`}
                  onClick={() => setValue(`packagings.${index}.isActive`, !active, { shouldDirty: true })}
                >
                  {active ? "Inativar" : "Reativar"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Remover embalagem ${position}`}
                  onClick={() => rows.remove(index)}
                >
                  Remover
                </Button>
              )}
            </div>
            {rowErrors?.content ? <p className="text-sm text-destructive">{rowErrors.content.message}</p> : null}
            {rowErrors?.gtin ? <p className="text-sm text-destructive">{rowErrors.gtin.message}</p> : null}
          </div>
        );
      })}

      {listError !== undefined ? <p className="text-sm text-destructive">{listError}</p> : null}

      <Button
        type="button"
        variant="outline"
        className="self-start"
        // The units a packaging is offered in depend on the product's.
        disabled={unit === undefined}
        onClick={() => unit && rows.append({ content: "", unit, gtin: "", isActive: true })}
      >
        Adicionar embalagem
      </Button>
    </fieldset>
  );
}
