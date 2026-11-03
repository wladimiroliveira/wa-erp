import * as React from "react";

import { Input } from "@/components/ui/input";
import { maskDecimalInput, padDecimalInput, stepDecimalInput } from "@/lib/decimal";
import { cn } from "@/lib/utils";

type NumericFormat = "decimal" | "digits";

const INPUT_MODES = { decimal: "decimal", digits: "numeric" } as const;

const STEPS: Record<string, 1 | -1> = { ArrowUp: 1, ArrowDown: -1 };

// What the operator typed, as opposed to what the mask put in between.
const TYPED = /[\d,]/;

/** Where the caret lands in the masked text, so that it stays after the same typed characters. */
function caretAfterMask(raw: string, caret: number, masked: string): number {
  let pending = [...raw.slice(0, caret)].filter((character) => TYPED.test(character)).length;
  let at = 0;

  while (pending > 0 && at < masked.length) {
    if (TYPED.test(masked.charAt(at))) pending -= 1;
    at += 1;
  }

  return at;
}

// The point only groups thousands in an amount, so the one just typed, as the key of a numeric
// keypad does, is taken for the comma it means.
function pointAsComma(typed: string, caret: number, cause: Event): string {
  const typedPoint = (cause as InputEvent).data === "." && typed.charAt(caret - 1) === ".";

  return typedPoint ? `${typed.slice(0, caret - 1)},${typed.slice(caret)}` : typed;
}

// React only notices a value written through the element's own setter, the one it did not wrap.
function writeAsTyped(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const ADORNMENT = "pointer-events-none absolute inset-y-0 flex items-center text-sm text-muted-foreground";

interface NumericInputProps extends Omit<React.ComponentProps<"input">, "type" | "inputMode"> {
  /** `decimal` is an amount, masked and stepped by the arrow keys; `digits` is a code made of numbers. */
  format?: NumericFormat;
  /** Decimal places an amount is completed to on leaving the field. */
  minFractionDigits?: number;
  /** Shown inside the field before the amount, as a currency symbol is. */
  leading?: string;
  /** Shown inside the field after the amount, as a unit is. */
  trailing?: string;
}

// Still a text field underneath: the amount stays a string, comma included, and never becomes a
// float on its way to the API. `toApiDecimal` turns what it shows into what the API takes.
function NumericInput({
  format = "decimal",
  minFractionDigits = 0,
  leading,
  trailing,
  maxLength,
  className,
  onChange,
  onKeyDown,
  onBlur,
  ...props
}: NumericInputProps) {
  const mask =
    format === "decimal" ? maskDecimalInput : (typed: string) => typed.replace(/\D/g, "").slice(0, maxLength);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget;
    const caret = field.selectionStart ?? field.value.length;
    const raw = format === "decimal" ? pointAsComma(field.value, caret, event.nativeEvent) : field.value;
    const masked = mask(raw);

    if (masked !== field.value) {
      const kept = caretAfterMask(raw, caret, masked);
      field.value = masked;
      field.setSelectionRange(kept, kept);
    }

    onChange?.(event);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);

    const step = STEPS[event.key];
    const field = event.currentTarget;
    if (format !== "decimal" || step === undefined || event.defaultPrevented || field.readOnly) return;

    event.preventDefault();
    const stepped = stepDecimalInput(field.value, step);
    if (stepped !== field.value) writeAsTyped(field, stepped);
  }

  function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
    const field = event.currentTarget;

    if (format === "decimal" && minFractionDigits > 0) {
      const padded = padDecimalInput(field.value, minFractionDigits);
      if (padded !== field.value) writeAsTyped(field, padded);
    }

    onBlur?.(event);
  }

  const field = (
    <Input
      type="text"
      inputMode={INPUT_MODES[format]}
      autoComplete="off"
      className={cn(leading !== undefined && "pl-9", trailing !== undefined && "pr-10", className)}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      {...props}
    />
  );

  if (leading === undefined && trailing === undefined) return field;

  return (
    <div className="relative">
      {leading !== undefined ? <span className={cn(ADORNMENT, "left-2.5")}>{leading}</span> : null}
      {field}
      {trailing !== undefined ? <span className={cn(ADORNMENT, "right-2.5")}>{trailing}</span> : null}
    </div>
  );
}

export { NumericInput };
