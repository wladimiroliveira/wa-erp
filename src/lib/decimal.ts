// The API takes and returns decimals as strings, so that no amount passes through a
// float on the way. Everything here works on the string for the same reason.
const INTEGER_DIGITS = 12;
const FRACTION_DIGITS = 6;

// What a field holds: the whole part with or without its thousands grouped, a comma, the decimals.
const DECIMAL_INPUT = new RegExp(
  `^(\\d{1,${INTEGER_DIGITS}}|\\d{1,3}(\\.\\d{3}){1,${INTEGER_DIGITS / 3 - 1}})(,\\d{1,${FRACTION_DIGITS}})?$`,
);

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function ungroupThousands(typed: string): string {
  return typed.replaceAll(".", "");
}

/** Whether the text of a field is a decimal the API accepts, once sent through `toApiDecimal`. */
export function isDecimalInput(typed: string): boolean {
  return DECIMAL_INPUT.test(typed);
}

/** A text as a decimal field shows it: thousands grouped, one comma, nothing a decimal cannot hold. */
export function maskDecimalInput(typed: string): string {
  const [whole = "", ...decimals] = typed.replace(/[^\d,]/g, "").split(",");
  const integer = groupThousands(whole.replace(/^0+(?=\d)/, "").slice(0, INTEGER_DIGITS));
  if (decimals.length === 0) return integer;

  return `${integer === "" ? "0" : integer},${decimals.join("").slice(0, FRACTION_DIGITS)}`;
}

/** Moves the whole part one up or one down. The text comes back untouched where the step has nowhere to go. */
export function stepDecimalInput(typed: string, direction: 1 | -1): string {
  const [whole = "", ...decimals] = ungroupThousands(maskDecimalInput(typed)).split(",");
  const stepped = BigInt(whole === "" ? "0" : whole) + BigInt(direction);
  if (stepped < 0n || stepped.toString().length > INTEGER_DIGITS) return typed;

  return maskDecimalInput([stepped.toString(), ...decimals].join(","));
}

/** A finished amount with at least the asked decimal places. What is not yet an amount comes back untouched. */
export function padDecimalInput(typed: string, minFractionDigits: number): string {
  const finished = typed.replace(/,$/, "");

  return isDecimalInput(finished) ? formatDecimal(toApiDecimal(finished), minFractionDigits) : typed;
}

export function toApiDecimal(typed: string): string {
  return ungroupThousands(typed).replace(",", ".");
}

/** The reverse of `toApiDecimal`: what a field shows of a decimal the API already holds. */
export function toDecimalInput(value: string): string {
  return formatDecimal(value);
}

/** Writes an API decimal the Portuguese way: `1234.5` becomes `1.234,5`. */
export function formatDecimal(value: string, minFractionDigits = 0): string {
  const [integer = "", fraction = ""] = value.split(".");
  const padded = fraction.padEnd(minFractionDigits, "0");

  return padded === "" ? groupThousands(integer) : `${groupThousands(integer)},${padded}`;
}

export function formatMoney(value: string): string {
  return `R$ ${formatDecimal(value, 2)}`;
}
