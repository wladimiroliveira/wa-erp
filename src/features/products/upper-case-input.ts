import type { ChangeEvent, CompositionEvent } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

function toUpperCase(input: HTMLInputElement): void {
  const { selectionStart, selectionEnd } = input;

  input.value = input.value.toLocaleUpperCase("pt-BR");
  input.setSelectionRange(selectionStart, selectionEnd);
}

/**
 * A registered input shown as it is stored: in upper case, the caret kept where the operator typed.
 * A word a phone keyboard is still composing is left alone, and written in upper case once composed.
 */
export function upperCaseAsTyped<Name extends string>(registration: UseFormRegisterReturn<Name>) {
  return {
    ...registration,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      if (!(event.nativeEvent as InputEvent).isComposing) toUpperCase(event.target);

      return registration.onChange(event);
    },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
      toUpperCase(event.currentTarget);
      void registration.onChange({ target: event.currentTarget, type: "change" });
    },
  };
}
