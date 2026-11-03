import { useRef } from "react";
import { toast } from "sonner";
import { resetTableLayout, saveTableLayout } from "@/features/table-layouts/actions";
import { useTableLayouts } from "@/features/table-layouts/table-layouts-context";
import type { TableLayout, TableLayoutBody } from "@/lib/api";

/**
 * The layout the user gave one table, and the ways to change it. A change shows at once and is
 * written behind it; if the write fails, the operator is told and the next session reads what the
 * server holds.
 */
export function useTableLayout(tableKey: string) {
  const { layouts, put } = useTableLayouts();
  const saved = layouts.find((layout) => layout.tableKey === tableKey);
  // One table's writes go out one at a time, in the order they were made, so the last one stays.
  const queue = useRef<Promise<void>>(Promise.resolve());

  // The change shows before the write; a write that fails puts back what the server still holds.
  function change(next: Omit<TableLayout, "tableKey"> | null, write: () => Promise<{ ok: boolean }>): void {
    const previous = saved === undefined ? null : { order: saved.order, widths: saved.widths };

    put(tableKey, next);
    queue.current = queue.current
      .then(write)
      .then((result) => {
        if (!result.ok) throw new Error("The layout was refused.");
      })
      .catch(() => {
        put(tableKey, previous);
        toast.error("Não foi possível salvar a disposição das colunas.");
      });
  }

  const save = (body: TableLayoutBody) => change(body, () => saveTableLayout(tableKey, body));
  const reset = () => change(null, () => resetTableLayout(tableKey));

  return { saved, save, reset };
}
