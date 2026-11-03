import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Why the list is empty. */
  children: ReactNode;
  /**
   * The way forward, as buttons. A list without rows shows no table, and so none of the controls
   * the table holds; whatever of them still makes sense goes here.
   */
  actions?: ReactNode;
}

/** Stands in for a table with no rows. */
export function EmptyState({ children, actions }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p>{children}</p>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
