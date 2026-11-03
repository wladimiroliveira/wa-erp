/** Narrower than this, the edge of a column is hard to grab back. */
export const MIN_COLUMN_WIDTH = 60;
/** The widest the API records. */
export const MAX_COLUMN_WIDTH = 2000;

/**
 * The order the table shows: the saved one, without the columns the table no longer has. A column
 * the saved order never knew — added to the screen later, or shown only to some — goes right after
 * the column designed before it, so it lands where it was meant to be instead of at the end.
 */
export function arrangeColumns(designed: string[], saved: string[] | undefined): string[] {
  if (saved === undefined) return designed;

  const arranged = saved.filter((key) => designed.includes(key));

  designed.forEach((key, index) => {
    if (arranged.includes(key)) return;

    const before = index === 0 ? -1 : arranged.indexOf(designed[index - 1]!);
    arranged.splice(before + 1, 0, key);
  });

  return arranged;
}

export function moveColumn(order: string[], key: string, toIndex: number): string[] {
  if (!order.includes(key)) return order;

  const rest = order.filter((other) => other !== key);
  const target = Math.min(Math.max(toIndex, 0), rest.length);

  return [...rest.slice(0, target), key, ...rest.slice(target)];
}

/** The gap, from 0 to the number of headers, that a column dragged to `x` falls into, given the horizontal middle of each header in order. */
export function dropIndexAt(middles: number[], x: number): number {
  const index = middles.findIndex((middle) => x < middle);

  return index === -1 ? middles.length : index;
}

export function clampWidth(width: number): number {
  return Math.min(Math.max(Math.round(width), MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
}

/**
 * Moves the border between `key` and its neighbour on the right by `delta`. Only those two change:
 * what one gains the other gives up, so the columns beyond stay put. Once the neighbour is down to
 * the least width, a wider column pushes the table instead; a column already at the least width
 * stops narrowing. The last column has no neighbour and resizes alone.
 */
export function resizeBetween(
  widths: Record<string, number>,
  key: string,
  neighbour: string | undefined,
  delta: number,
): Record<string, number> {
  const width = widths[key]!;

  if (neighbour === undefined) return { ...widths, [key]: clampWidth(width + delta) };

  const across = widths[neighbour]!;

  if (delta >= 0) {
    const taken = Math.min(delta, Math.max(across - MIN_COLUMN_WIDTH, 0));
    return { ...widths, [key]: clampWidth(width + delta), [neighbour]: across - taken };
  }

  const given = Math.min(-delta, Math.max(width - MIN_COLUMN_WIDTH, 0));
  return { ...widths, [key]: width - given, [neighbour]: across + given };
}
