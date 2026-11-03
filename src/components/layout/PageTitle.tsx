"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Where the shell's top bar wants the current screen's title; `null` outside the shell. */
const TitleSlotContext = createContext<HTMLElement | null>(null);

export const TitleSlotProvider = TitleSlotContext.Provider;

/**
 * A screen names itself through this rather than its own `<h1>`, so the title can
 * live in the top bar while the screen still decides what it says — including a
 * title made from loaded data. Outside the shell, as in a screen's own tests, it
 * stays where it was written.
 */
export function PageTitle({ children }: { children: ReactNode }) {
  const slot = useContext(TitleSlotContext);
  const heading = <h1 className="truncate text-lg font-semibold">{children}</h1>;

  return slot ? createPortal(heading, slot) : heading;
}
