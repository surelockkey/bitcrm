import type { ComponentProps, ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The 3px rule down the card's left edge (Workiz `left-green` / `left-orange` / `left-red`). */
export type WzStatTone = "ink" | "orange" | "red";

const RULE: Record<WzStatTone, string> = {
  // `left-green` is drawn in the ink, rgb(59,75,82), despite its name.
  ink: "border-l-foreground",
  // pg_contacts_wz_01_default: rgb(255,174,0) and rgb(221,56,13) — only these cards use them.
  orange: "border-l-[#ffae00]",
  red: "border-l-[#dd380d]",
};

/** The card's box: 81px, 15px in, the 3px rule, MUI's elevation-2 shadow, square corners. */
const BOX =
  "h-[81px] border-l-[3px] bg-background p-[15px] shadow-[0_3px_1px_-2px_rgba(0,0,0,0.14),0_2px_2px_0_rgba(0,0,0,0.098),0_1px_5px_0_rgba(0,0,0,0.082)]";

/**
 * Workiz's KPI card (`._fCard`, pg_contacts_wz_01_default: the Clients page's
 * "370,358 / Clients", "$495,463.7 / Due from 335 clients"): 317×81, a 3px
 * rule on the left, the number 19.6px/25px 500 #3e4b51 over a 14px #999
 * caption, both right-aligned, 8px apart.
 *
 * Not a control: Workiz makes some of its cards open a report; a page that has
 * nothing behind a card leaves it a plain figure rather than a dead button.
 * Named by `label` (or the caption) for screen readers.
 */
export function WzStatCard({
  value,
  caption,
  tone = "ink",
  label,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  value: ReactNode;
  caption: ReactNode;
  tone?: WzStatTone;
  /** Accessible name when the caption is not a plain string. */
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label ?? (typeof caption === "string" ? caption : undefined)}
      data-slot="wz-stat-card"
      className={cn(BOX, RULE[tone], "min-w-0 text-right", className)}
      {...props}
    >
      <div className="truncate text-[19.6px] leading-[25px] font-medium tracking-[0.4px] text-wz-tab-bar tabular-nums">
        {value}
      </div>
      <div className="mt-2 truncate text-sm leading-4 tracking-[0.4px] text-wz-caption">{caption}</div>
    </div>
  );
}

/** The card while its number is on the way: the same box, grey bars where the words go. */
export function WzStatCardSkeleton({ tone = "ink", className }: { tone?: WzStatTone; className?: string }) {
  return (
    <div data-testid="wz-stat-card-skeleton" aria-hidden className={cn(BOX, RULE[tone], "flex flex-col items-end", className)}>
      <Skeleton className="h-[25px] w-28" />
      <Skeleton className="mt-2 h-4 w-36" />
    </div>
  );
}
