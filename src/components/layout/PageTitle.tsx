"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Where the shell's top bar wants the current screen's title; `null` outside the shell. */
const TitleSlotContext = createContext<HTMLElement | null>(null);

export const TitleSlotProvider = TitleSlotContext.Provider;

/** Where the breadcrumbs want the current screen's name, as their last step; `null` when there is no trail. */
const CrumbSlotContext = createContext<HTMLElement | null>(null);

export const CrumbSlotProvider = CrumbSlotContext.Provider;

/** Where the shell wants what a screen sets aside, on the breadcrumbs' line; `null` outside the shell. */
const AsideSlotContext = createContext<HTMLElement | null>(null);

export const AsideSlotProvider = AsideSlotContext.Provider;

/**
 * A screen names itself through this rather than its own `<h1>`, so the title can
 * live in the top bar while the screen still decides what it says — including a
 * title made from loaded data. Outside the shell, as in a screen's own tests, it
 * stays where it was written.
 */
export function PageTitle({
  children,
  crumb = children,
}: {
  children: ReactNode;
  /** How the breadcrumbs name this screen, when the title is a general one and the trail says which. */
  crumb?: ReactNode;
}) {
  const slot = useContext(TitleSlotContext);
  const crumbSlot = useContext(CrumbSlotContext);
  const heading = <h1 className="truncate text-lg font-semibold">{children}</h1>;

  return (
    <>
      {slot ? createPortal(heading, slot) : heading}
      {crumbSlot
        ? createPortal(
            <span aria-current="page" className="font-medium text-foreground">
              {crumb}
            </span>,
            crumbSlot,
          )
        : null}
    </>
  );
}

/**
 * Supporting facts of a screen, such as its status, which the shell shows at the right end of the
 * breadcrumbs' line, out of the way of the screen itself. Outside the shell they stay where written.
 */
export function PageAside({ children }: { children: ReactNode }) {
  const slot = useContext(AsideSlotContext);

  return slot ? createPortal(children, slot) : children;
}
