"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { TableLayout } from "@/lib/api";

export interface TableLayoutsValue {
  layouts: TableLayout[];
  /** Replaces what the session holds for one table; `null` forgets it. */
  put: (tableKey: string, layout: Omit<TableLayout, "tableKey"> | null) => void;
}

const TableLayoutsContext = createContext<TableLayoutsValue | null>(null);

/**
 * The layouts the user gave their tables, as the server layout read them once for the session.
 * Only this user changes them, and another device's change shows on the next session, so the
 * list lives in state here and each table reads and rewrites its own entry.
 */
export function TableLayoutsProvider({ initial, children }: { initial: TableLayout[]; children: ReactNode }) {
  const [layouts, setLayouts] = useState(initial);

  const put: TableLayoutsValue["put"] = (tableKey, layout) =>
    setLayouts((current) => {
      const others = current.filter((entry) => entry.tableKey !== tableKey);

      return layout === null ? others : [...others, { tableKey, ...layout }];
    });

  return <TableLayoutsContext value={{ layouts, put }}>{children}</TableLayoutsContext>;
}

export function useTableLayouts(): TableLayoutsValue {
  const value = useContext(TableLayoutsContext);

  if (value === null) throw new Error("useTableLayouts must be used inside a TableLayoutsProvider.");

  return value;
}
