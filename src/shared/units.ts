import type { MeasurementUnit } from "./enums";

// Units of one dimension, shared by the server and the browser. Within a dimension the units differ
// by powers of 1000, so converting only moves the decimal point of the string: nothing is rounded.

export type Dimension = "MASS" | "VOLUME" | "COUNT";

// Each unit's dimension and its power of ten against the smallest unit of that dimension.
const UNITS: Record<MeasurementUnit, { dimension: Dimension; exponent: number }> = {
  KILOGRAM: { dimension: "MASS", exponent: 3 },
  GRAM: { dimension: "MASS", exponent: 0 },
  LITER: { dimension: "VOLUME", exponent: 3 },
  MILLILITER: { dimension: "VOLUME", exponent: 0 },
  UNIT: { dimension: "COUNT", exponent: 0 },
};

// Larger first: the order a select offers them in.
const BY_DIMENSION: Record<Dimension, [MeasurementUnit, ...MeasurementUnit[]]> = {
  MASS: ["KILOGRAM", "GRAM"],
  VOLUME: ["LITER", "MILLILITER"],
  COUNT: ["UNIT"],
};

export class IncompatibleUnitsError extends Error {
  constructor(from: MeasurementUnit, to: MeasurementUnit) {
    super(`${from} cannot be converted to ${to}.`);
    this.name = "IncompatibleUnitsError";
  }
}

export function dimensionOf(unit: MeasurementUnit): Dimension {
  return UNITS[unit].dimension;
}

export function compatibleUnits(unit: MeasurementUnit): [MeasurementUnit, ...MeasurementUnit[]] {
  return BY_DIMENSION[dimensionOf(unit)];
}

/** A non-negative decimal string times 10^power, written without leading or trailing zeros. */
function shift(value: string, power: number): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const digits = integer + fraction;
  const point = integer.length + power;
  const padded = point <= 0 ? "0".repeat(1 - point) + digits : digits.padEnd(point, "0");
  const at = Math.max(point, 1);
  const whole = padded.slice(0, at).replace(/^0+(?=\d)/, "");
  const decimals = padded.slice(at).replace(/0+$/, "");

  return decimals === "" ? whole : `${whole}.${decimals}`;
}

export function convert(quantity: string, from: MeasurementUnit, to: MeasurementUnit): string {
  if (dimensionOf(from) !== dimensionOf(to)) throw new IncompatibleUnitsError(from, to);

  return shift(quantity, UNITS[from].exponent - UNITS[to].exponent);
}

/** The quantity in the unit of its dimension that reads best: 1 kg or 1 L and up in the larger unit. */
export function readableQuantity(quantity: string, unit: MeasurementUnit): { quantity: string; unit: MeasurementUnit } {
  const [larger, smaller = larger] = compatibleUnits(unit);
  const target = Number(convert(quantity, unit, larger)) >= 1 ? larger : smaller;

  return { quantity: convert(quantity, unit, target), unit: target };
}

/** A decimal string written one way only, so that two writings of a number compare equal: 1.000000 is 1. */
export const normalizeDecimal = (value: string): string => shift(value, 0);
