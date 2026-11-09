// Decimal strings worked as scaled BigInts: the browser has no decimal library, and a float would
// miss cents. Shared by every calculation that runs on both the server and the client.

export const scale = (places: number) => 10n ** BigInt(places);

/** A non-negative decimal string as an integer counting units of 10^-places. */
export function toScaled(value: string, places: number): bigint {
  const [integer = "0", fraction = ""] = value.split(".");

  return BigInt(integer + fraction.padEnd(places, "0").slice(0, places));
}

export function fromScaled(value: bigint, places: number): string {
  const digits = value.toString().padStart(places + 1, "0");

  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

export const divideHalfUp = (dividend: bigint, divisor: bigint) => (2n * dividend + divisor) / (2n * divisor);

/** A non-negative decimal string rounded half up to `places` (at least 1), written with exactly that many. */
export function roundHalfUp(value: string, places: number): string {
  const digits = Math.max(places, value.split(".")[1]?.length ?? 0);

  return fromScaled(divideHalfUp(toScaled(value, digits), scale(digits - places)), places);
}

/** An amount of money as it is shown: in cents, rounded half up. */
export const roundToCents = (value: string): string => roundHalfUp(value, 2);
