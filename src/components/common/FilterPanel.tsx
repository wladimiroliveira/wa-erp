import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface FilterPanelProps {
  /** Names the panel for assistive technology. */
  label: string;
  children?: ReactNode;
  /** Runs the query with the filters as they stand. Changing a filter alone runs nothing. */
  onSubmit: () => void;
  /** Offered only when given, so the button shows up only when there is something to clear. */
  onClear?: () => void;
}

/** Bounds the filters of a list and runs them on demand, with Consultar or Enter in a field. */
export function FilterPanel({ label, children, onSubmit, onClear }: FilterPanelProps) {
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form
      role="search"
      aria-label={label}
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
    >
      {children}
      <Button type="submit">Consultar</Button>
      {onClear === undefined ? null : (
        <Button type="button" variant="ghost" onClick={onClear}>
          Limpar filtros
        </Button>
      )}
    </form>
  );
}
