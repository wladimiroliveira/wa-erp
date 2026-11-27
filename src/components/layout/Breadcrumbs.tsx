"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { isCurrent, NAV_ITEMS } from "@/components/layout/nav-items";

/**
 * Where the screen sits: the start, the section of the menu it is under, and the screen itself,
 * whose name the screen gives through `PageTitle` into `currentSlotRef`. The start screen has no trail.
 */
export function Breadcrumbs({
  currentSlotRef,
  asideSlotRef,
}: {
  currentSlotRef: (element: HTMLElement | null) => void;
  /** Where the screen's `PageAside` goes, at the right end of the same line. */
  asideSlotRef: (element: HTMLElement | null) => void;
}) {
  const pathname = usePathname();

  if (pathname === "/") return null;

  // The section is a step of its own only below its screen: on the section's screen it is the current step.
  const section = NAV_ITEMS.find((item) => isCurrent(pathname, item.to) && pathname !== item.to);
  const steps = [{ href: "/", label: "Início" }, ...(section ? [{ href: section.to, label: section.label }] : [])];

  return (
    // Each side scrolls sideways on its own rather than wrap or run into the other; the trail fades out
    // at its right edge where it meets the aside.
    <div className="flex min-w-0 items-center gap-2 px-4 pt-2 text-xs text-muted-foreground">
      <div className="relative min-w-0 flex-1">
        <nav aria-label="Trilha de navegação" className={`overflow-x-auto pr-6 ${NO_SCROLLBAR}`}>
          <ol className="flex w-max items-center gap-1.5 whitespace-nowrap">
            {steps.map(({ href, label }) => (
              <Fragment key={href}>
                <li>
                  <Link href={href} className="hover:text-foreground hover:underline underline-offset-4">
                    {label}
                  </Link>
                </li>
                <li aria-hidden="true">
                  <ChevronRight className="size-3" />
                </li>
              </Fragment>
            ))}
            <li ref={currentSlotRef} className="flex" />
          </ol>
        </nav>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
        />
      </div>
      {/* At most half the line, so the trail always keeps the other half; past that the aside scrolls. */}
      <div
        ref={asideSlotRef}
        className={`flex min-w-0 max-w-[50%] shrink-0 overflow-x-auto whitespace-nowrap ${NO_SCROLLBAR}`}
      />
    </div>
  );
}

const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
