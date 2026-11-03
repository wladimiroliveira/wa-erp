import type { MeasurementUnit } from "@/lib/api";

/** Display order, and the list a form iterates over. `UnitCoverage` stops it from drifting from the API. */
export const UNITS = ["UNIT", "KILOGRAM", "GRAM", "LITER", "MILLILITER"] as const satisfies readonly MeasurementUnit[];

type AssertNever<T extends never> = T;

/** Fails to compile if the API grows a unit this file does not know about. */
export type UnitCoverage = AssertNever<Exclude<MeasurementUnit, (typeof UNITS)[number]>>;

const UNIT_LABELS: Record<MeasurementUnit, string> = {
  UNIT: "un",
  KILOGRAM: "kg",
  GRAM: "g",
  LITER: "L",
  MILLILITER: "mL",
};

const UNIT_NAMES: Record<MeasurementUnit, string> = {
  UNIT: "Unidade",
  KILOGRAM: "Quilograma",
  GRAM: "Grama",
  LITER: "Litro",
  MILLILITER: "Mililitro",
};

export function unitLabel(unit: MeasurementUnit): string {
  return UNIT_LABELS[unit];
}

export function unitName(unit: MeasurementUnit): string {
  return `${UNIT_NAMES[unit]} (${UNIT_LABELS[unit]})`;
}
