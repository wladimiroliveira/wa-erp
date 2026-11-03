import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type IconButtonProps = {
  /** Names the button for assistive technology, since it shows no text. */
  label: string;
  /** What the tooltip says on hover; the label when it needs no more than that. */
  hint?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  /** The icon. */
  children: ReactNode;
} & (
  | { onClick: () => void; to?: never }
  /** A link that looks like the button, for an action that is a screen of its own. */
  | { to: string; onClick?: never }
);

/** A small button that shows only an icon and explains itself in a tooltip. */
export function IconButton({ label, hint = label, variant = "ghost", children, onClick, to }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          to === undefined ? (
            <Button type="button" variant={variant} size="icon-xs" aria-label={label} />
          ) : (
            <Link href={to} aria-label={label} className={buttonVariants({ variant, size: "icon-xs" })} />
          )
        }
        onClick={onClick}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
