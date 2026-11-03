import type { ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface FacetOption<T extends string> {
  value: T;
  label: string;
}

/** The trigger reads what is in effect, so the toolbar shows the filters without opening anything. */
function Facet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" />}>
        {title}
        <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-48">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

interface FacetFilterProps<T extends string> {
  label: string;
  options: readonly FacetOption<T>[];
  selected: readonly T[];
  /** The selection in the order of `options`, whatever order it was ticked in. */
  onChange: (selected: T[]) => void;
}

/** Narrows a list to any of several values. Nothing ticked filters nothing. */
export function FacetFilter<T extends string>({ label, options, selected, onChange }: FacetFilterProps<T>) {
  const ticked = options.filter((option) => selected.includes(option.value));
  const title =
    ticked.length === 0
      ? label
      : ticked.length === 1
        ? `${label}: ${ticked[0]!.label}`
        : `${label}: ${ticked.length} opções`;

  function toggle(value: T, checked: boolean): void {
    onChange(options.map((option) => option.value).filter((v) => (v === value ? checked : selected.includes(v))));
  }

  return (
    <Facet title={title}>
      {options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.value}
          checked={selected.includes(option.value)}
          onCheckedChange={(checked) => toggle(option.value, checked)}
        >
          {option.label}
        </DropdownMenuCheckboxItem>
      ))}
    </Facet>
  );
}

interface FacetChoiceProps<T extends string> {
  label: string;
  options: readonly FacetOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Narrows a list to exactly one of its options; one of them is always in effect. */
export function FacetChoice<T extends string>({ label, options, value, onChange }: FacetChoiceProps<T>) {
  const current = options.find((option) => option.value === value);

  return (
    <Facet title={current === undefined ? label : `${label}: ${current.label}`}>
      <DropdownMenuRadioGroup value={value} onValueChange={(next: T) => onChange(next)}>
        {options.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </Facet>
  );
}
