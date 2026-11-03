/** Whether the last digit of a GTIN is the one the others add up to, whatever its length. */
export function hasValidCheckDigit(code: string): boolean {
  const weighted = [...code]
    .reverse()
    .reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);

  return weighted % 10 === 0;
}
