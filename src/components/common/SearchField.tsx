import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

interface SearchFieldProps {
  /** Names the field for assistive technology; the placeholder is not a label. */
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}

export function SearchField({ label, placeholder, value, onChange }: SearchFieldProps) {
  return (
    <div className="relative w-full sm:w-72">
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pl-8"
      />
    </div>
  );
}
