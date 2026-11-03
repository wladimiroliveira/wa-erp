// A list screen keeps its filters in the address, so a reload, the back button or a shared link
// opens the same list. These read and write one parameter at a time and know nothing of any screen.

/** The values of a repeated parameter that `allowed` knows, in the order the address wrote them. */
export function readList<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T[] {
  return params.getAll(key).filter((value): value is T => (allowed as readonly string[]).includes(value));
}

/** A text parameter trimmed, or undefined when it is missing or blank. */
export function readText(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();

  return value === undefined || value === "" ? undefined : value;
}

/** A copy of `params` with `key` holding `values`. Blank values are dropped, and so is a key left with none. */
export function withValues(params: URLSearchParams, key: string, values: readonly string[]): URLSearchParams {
  const next = new URLSearchParams(params);

  next.delete(key);
  for (const value of values) if (value.trim() !== "") next.append(key, value);

  return next;
}
