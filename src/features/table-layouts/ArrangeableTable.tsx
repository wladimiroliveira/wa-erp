import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { GripVerticalIcon, RotateCcwIcon } from "lucide-react";
import { IconButton } from "@/components/common/IconButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  arrangeColumns,
  clampWidth,
  dropIndexAt,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveColumn,
  resizeBetween,
} from "@/features/table-layouts/column-layout";
import { useTableLayout } from "@/features/table-layouts/use-table-layout";
import { cn } from "@/lib/utils";

export interface Column<Row> {
  /** Names the column in the saved layout. Changing it loses the place and width the users gave it. */
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
}

interface ArrangeableTableProps<Row> {
  /** Names the table in the saved layouts: one per screen, never shared by two. */
  tableKey: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** What a row is, to count them above the table: "1 produto", "2 produtos". */
  rowNoun: { one: string; other: string };
  /** Controls the screen offers over its rows, shown at the end of the row of the count. */
  actions?: ReactNode;
  fill?: boolean;
}

/** How far one arrow key widens or narrows a column. */
const RESIZE_STEP = 16;
/** The width of a column added to the screen after the user fixed the widths of the others. */
const NEW_COLUMN_WIDTH = 160;

type Widths = Record<string, number>;

/** Which side of its header a handle sits on. Only the first column has one on the left. */
type Side = "start" | "end";

/**
 * A table whose columns the user drags into another order, by the grip in each header, and
 * resizes, by the edge of each header — with the pointer, a finger or the arrow keys. The layout
 * is saved to the user, so it follows them to any device.
 *
 * Until a column is resized the table sizes its columns to their content. The first resize fixes
 * every width as it stands on the screen, so the others do not shift under the one being dragged.
 * The table never gets narrower than its container: the last column grows into whatever
 * room the others leave, so no gap opens at the right.
 */
export function ArrangeableTable<Row>({
  tableKey,
  columns,
  rows,
  rowKey,
  rowNoun,
  actions,
  fill = false,
}: ArrangeableTableProps<Row>) {
  const { saved, save, reset } = useTableLayout(tableKey);
  const headers = useRef(new Map<string, HTMLTableCellElement>());
  const grips = useRef(new Map<string, HTMLButtonElement>());
  const [dragging, setDragging] = useState<{ key: string; gap: number | null } | null>(null);
  // Widths while an edge is being dragged, written to the server only when it is let go.
  const [draft, setDraft] = useState<Widths | null>(null);
  const resizing = useRef<{ key: string; side: Side; startX: number; base: Widths } | null>(null);
  const [refocus, setRefocus] = useState<string | null>(null);

  const order = arrangeColumns(
    columns.map((column) => column.key),
    saved?.order,
  );
  const shown = order.map((key) => columns.find((column) => column.key === key)!);
  const widths = draft ?? saved?.widths ?? {};
  const fixed = Object.keys(widths).length > 0;
  const widthOf = (key: string) => widths[key] ?? NEW_COLUMN_WIDTH;
  // Under a fixed layout the one column without a width takes the space left over.
  const filler = order.at(-1);

  useEffect(() => {
    if (refocus === null) return;
    grips.current.get(refocus)?.focus();
    setRefocus(null);
  }, [refocus]);

  const persist = (change: { order?: string[]; widths?: Widths }) =>
    save({ order: change.order ?? saved?.order ?? [], widths: change.widths ?? saved?.widths ?? {} });

  /** The widths to resize from: the saved ones, or else every column as wide as it shows now. */
  const startingWidths = (): Widths =>
    fixed
      ? Object.fromEntries(
          shown.map((column) => [
            column.key,
            // The filler may show wider than saved; a drag starts from what the user sees.
            column.key === filler
              ? clampWidth(Math.max(widthOf(column.key), headers.current.get(column.key)?.offsetWidth ?? 0))
              : widthOf(column.key),
          ]),
        )
      : Object.fromEntries(
          shown.map((column) => [column.key, clampWidth(headers.current.get(column.key)?.offsetWidth ?? 0)]),
        );

  /** The column across the border a resize moves: the next one, if any. */
  const neighbourOf = (key: string): string | undefined => order[order.indexOf(key) + 1];

  function moveTo(key: string, target: number): void {
    if (target === order.indexOf(key)) return;
    persist({ order: moveColumn(order, key, target) });
  }

  function onGripKeyDown(key: string, event: KeyboardEvent): void {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step === undefined) return;

    event.preventDefault();
    moveTo(key, order.indexOf(key) + step);
    setRefocus(key);
  }

  function onGripPointerDown(key: string, event: PointerEvent): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({ key, gap: null });
  }

  function onGripPointerMove(event: PointerEvent): void {
    if (dragging === null) return;

    const middles = order.map((key) => {
      const box = headers.current.get(key)!.getBoundingClientRect();
      return box.left + box.width / 2;
    });
    setDragging({ ...dragging, gap: dropIndexAt(middles, event.clientX) });
  }

  function onGripPointerUp(): void {
    if (dragging?.gap != null) {
      const from = order.indexOf(dragging.key);
      // The gaps count the column being dragged; past it, they sit one place further on.
      moveTo(dragging.key, dragging.gap > from ? dragging.gap - 1 : dragging.gap);
    }
    setDragging(null);
  }

  /**
   * The new widths after the `side` of `key` moved right by `shift`. The right side trades with the
   * neighbour; the left side of the first column is the outer edge, so the column grows as it moves
   * away and resizes alone.
   */
  const resized = (base: Widths, key: string, side: Side, shift: number): Widths =>
    side === "end" ? resizeBetween(base, key, neighbourOf(key), shift) : resizeBetween(base, key, undefined, -shift);

  function onEdgeKeyDown(key: string, side: Side, event: KeyboardEvent): void {
    const shift = { ArrowLeft: -RESIZE_STEP, ArrowRight: RESIZE_STEP }[event.key];
    if (shift === undefined) return;

    event.preventDefault();
    persist({ widths: resized(startingWidths(), key, side, shift) });
  }

  function onEdgePointerDown(key: string, side: Side, event: PointerEvent): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = startingWidths();
    resizing.current = { key, side, startX: event.clientX, base };
    setDraft(base);
  }

  const resizedTo = (event: PointerEvent): Widths => {
    const { key, side, startX, base } = resizing.current!;
    return resized(base, key, side, event.clientX - startX);
  };

  const edge = (column: Column<Row>, side: Side) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Redimensionar coluna ${column.header}${side === "start" ? " pela esquerda" : ""}`}
      aria-valuenow={fixed ? widthOf(column.key) : undefined}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      tabIndex={0}
      className={cn(
        "absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-primary/40 focus-visible:bg-primary/60",
        // Centred on a border between two columns; held inside the table on its outer edges, where
        // the scrolling container would cut off whatever stuck out.
        side === "start" ? "left-0" : column.key === order.at(-1) ? "right-0" : "-right-1",
      )}
      onKeyDown={(event) => onEdgeKeyDown(column.key, side, event)}
      onPointerDown={(event) => onEdgePointerDown(column.key, side, event)}
      onPointerMove={onEdgePointerMove}
      onPointerUp={onEdgePointerUp}
      onPointerCancel={() => {
        resizing.current = null;
        setDraft(null);
      }}
    />
  );

  function onEdgePointerMove(event: PointerEvent): void {
    if (resizing.current !== null) setDraft(resizedTo(event));
  }

  function onEdgePointerUp(event: PointerEvent): void {
    if (resizing.current === null) return;
    persist({ widths: resizedTo(event) });
    resizing.current = null;
    setDraft(null);
  }

  return (
    <div className={cn("flex flex-col gap-2", fill && "min-h-0 flex-1")}>
      {/* As tall as the button, so the table does not shift when the button comes and goes. */}
      <div className="flex h-6 items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? rowNoun.one : rowNoun.other}
        </p>
        {saved !== undefined ? (
          <IconButton
            label="Restaurar colunas"
            hint="Restaurar a ordem e a largura originais das colunas"
            onClick={reset}
          >
            <RotateCcwIcon aria-hidden="true" />
          </IconButton>
        ) : null}
        {actions}
      </div>
      <Table
        fill={fill}
        style={
          fixed
            ? {
                tableLayout: "fixed",
                width: shown.reduce((total, column) => total + widthOf(column.key), 0),
                minWidth: "100%",
              }
            : undefined
        }
      >
        <TableHeader>
          <TableRow>
            {shown.map((column) => {
              const index = order.indexOf(column.key);
              const gap = dragging?.gap;

              return (
                <TableHead
                  key={column.key}
                  ref={(element) => {
                    if (element === null) headers.current.delete(column.key);
                    else headers.current.set(column.key, element);
                  }}
                  // Named by its title alone: the grip and the edge inside it are controls, not part of the name.
                  aria-label={column.header}
                  style={fixed && column.key !== filler ? { width: widthOf(column.key) } : undefined}
                  className={cn(
                    "relative",
                    dragging?.key === column.key && "opacity-50",
                    // Where the dragged column will land: a line on the near edge of the gap.
                    gap != null && gap === index && "shadow-[inset_2px_0_0_var(--color-primary)]",
                    gap != null &&
                      gap === order.length &&
                      index === order.length - 1 &&
                      "shadow-[inset_-2px_0_0_var(--color-primary)]",
                  )}
                >
                  <>
                    {index === 0 ? edge(column, "start") : null}
                    {/* The title clips itself; clipping the header instead would cut its handles in half. */}
                    <div className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        ref={(element) => {
                          if (element === null) grips.current.delete(column.key);
                          else grips.current.set(column.key, element);
                        }}
                        aria-label={`Mover coluna ${column.header}`}
                        className="-ml-1 shrink-0 cursor-grab touch-none rounded-sm text-muted-foreground/60 outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                        onKeyDown={(event) => onGripKeyDown(column.key, event)}
                        onPointerDown={(event) => onGripPointerDown(column.key, event)}
                        onPointerMove={onGripPointerMove}
                        onPointerUp={onGripPointerUp}
                        onPointerCancel={() => setDragging(null)}
                      >
                        <GripVerticalIcon className="size-3.5" aria-hidden="true" />
                      </button>
                      <span className="truncate">{column.header}</span>
                    </div>
                    {edge(column, "end")}
                  </>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {shown.map((column) => (
                <TableCell key={column.key} className={cn(fixed && "overflow-hidden text-ellipsis")}>
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
