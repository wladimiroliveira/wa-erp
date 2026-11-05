"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Permission } from "@/lib/api";
import { labelFor, PERMISSION_GROUPS } from "@/lib/permissions";

interface PermissionCheckboxesProps {
  /** Keeps the ids unique per form; each checkbox gets `${idPrefix}-${permission}`. */
  idPrefix: string;
  selected: readonly Permission[];
  onToggle: (permission: Permission, checked: boolean) => void;
}

/** Every permission, grouped as the menu groups them, each with its own checkbox. */
export function PermissionCheckboxes({ idPrefix, selected, onToggle }: PermissionCheckboxesProps) {
  return PERMISSION_GROUPS.map((group) => (
    <div key={group.title} className="flex flex-col">
      <p className="text-sm text-muted-foreground">{group.title}</p>

      {group.permissions.map((permission) => (
        // `min-h-8` is not decoration. The Checkbox carries a 32px invisible hit
        // area around a 16px box, so in a row only as tall as its text the hit
        // areas of neighbouring rows overlap — a tap between two of them toggles
        // whichever wins the z-order, a wrong permission granted, silently.
        // Sizing the row to the target makes them tile instead.
        <div key={permission} className="flex min-h-8 items-center gap-2">
          <Checkbox
            id={`${idPrefix}-${permission}`}
            checked={selected.includes(permission)}
            onCheckedChange={(checked) => onToggle(permission, checked === true)}
          />
          <Label htmlFor={`${idPrefix}-${permission}`} className="flex-1 py-1.5">
            {labelFor(permission)}
          </Label>
        </div>
      ))}
    </div>
  ));
}
