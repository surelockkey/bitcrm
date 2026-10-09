import type { ComponentProps, ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The 3px rule down the card's left edge (Workiz `left-green` / `left-orange` /
 * `left-red`, and Aging invoices' `lightYellowCard` / `lightRedCard`).
 */
export type WzKpiTone = "ink" | "orange" | "red" | "lightYellow" | "lightRed";

const RULE: Record<WzKpiTone, string> = {
  // `left-green` is drawn in the ink, rgb(59,75,82), despite its name.
  ink: "border-l-foreground",
  // pg_contacts_wz_01_default: rgb(255,174,0) and rgb(221,56,13) — only these cards use them.
  orange: "border-l-[#ffae00]",
  red: "border-l-[#dd380d]",
  // rep_aging_wz_01_default: rgb(255,213,123) "under 30 days", rgb(255,119,83) "60-90 days".
  lightYellow: "border-l-[#ffd57b]",
  lightRed: "border-l-[#ff7753]",
};

/** The card's box: 15px in, the 3px rule, MUI's elevation-2 shadow, square corners. */
const SHELL =
  "border-l-[3px] p-[15px] shadow-[0_3px_1px_-2px_rgba(0,0,0,0.14),0_2px_2px_0_rgba(0,0,0,0.098),0_1px_5px_0_rgba(0,0,0,0.082)]";
/** 81px: one line of caption. */
const BOX = `h-[81px] ${SHELL}`;
/**
 * The Estimates page's status cards (uikit_wz_estimates): the same box, but
 * "50 Worth $8,702,853.93" wraps under the status, so a card is 81px with one
 * line and 97px with two.
 */
const GROWING_BOX = `min-h-[81px] ${SHELL}`;

/**
 * `.c_hover` under the cursor (rep_aging_wz_02_card_hover): the shadow drops
 * to `0 12px 12px -8px rgba(0,0,0,.4)`; the chosen card (`.selectedCard`,
 * rep_aging_wz_01_default) sits on rgb(240,240,240).
 */
const PICKABLE =
  "flex w-full cursor-pointer flex-col outline-none hover:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4)] focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * Workiz's KPI card (`._fCard`, pg_contacts_wz_01_default: the Clients page's
 * "370,358 / Clients", "$495,463.7 / Due from 335 clients"): 317×81, a 3px
 * rule on the left, the number 19.6px/25px 500 #3e4b51 over a 14px #999
 * caption, both right-aligned, 8px apart.
 *
 * Not a control by default: Workiz makes some of its cards open a report; a
 * page that has nothing behind a card leaves it a plain figure rather than a
 * dead button. Named by `label` (or the caption) for screen readers.
 *
 * `onSelect` makes it the card that IS the filter (Aging invoices' five
 * cards): a toggle button, `selected` drawing Workiz's chosen grey.
 */
export function WzKpiCard({
  value,
  caption,
  tone = "ink",
  label,
  onSelect,
  selected = false,
  selectedTone,
  wrapCaption = false,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "onSelect"> & {
  value: ReactNode;
  caption: ReactNode;
  tone?: WzKpiTone;
  /** Accessible name when the caption is not a plain string. */
  label?: string;
  /** The card picks something (a filter): it becomes a toggle button. */
  onSelect?: () => void;
  /** The pick this card stands for is the current one. */
  selected?: boolean;
  /**
   * The chosen card's rule instead of the chosen grey: the Estimates page's
   * card turns `left-orange` (#ffae00) on a white box
   * (pg_estimates_wz_06_card_won). Unset: Aging's `.selectedCard` grey.
   */
  selectedTone?: WzKpiTone;
  /** The caption wraps and the card grows (81px → 97px) instead of cutting it (Estimates). */
  wrapCaption?: boolean;
}) {
  const name = label ?? (typeof caption === "string" ? caption : undefined);
  const box = wrapCaption ? GROWING_BOX : BOX;
  // The pickable card is laid out from the top (a button would centre it a
  // pixel down) with the caption's line 10px under the figure: glyph rows
  // 144–162 and 176–192, as rep_aging_wz_01_default draws them.
  const body = (
    <>
      <div className="w-full truncate text-[19.6px] leading-[25px] font-medium tracking-[0.4px] text-wz-tab-bar tabular-nums">
        {value}
      </div>
      <div className={cn("w-full text-sm leading-4 tracking-[0.4px] text-wz-caption", !wrapCaption && "truncate", onSelect ? "mt-2.5" : "mt-2")}>
        {caption}
      </div>
    </>
  );
  if (onSelect) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        aria-label={name}
        data-slot="wz-kpi-card"
        onClick={onSelect}
        className={cn(
          box,
          selected && selectedTone ? RULE[selectedTone] : RULE[tone],
          PICKABLE,
          "min-w-0 text-right",
          selected && !selectedTone ? "bg-[#f0f0f0]" : "bg-background",
          className,
        )}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label={name}
      data-slot="wz-kpi-card"
      className={cn(box, RULE[tone], "min-w-0 bg-background text-right", className)}
      {...props}
    >
      {body}
    </div>
  );
}

/** The card while its number is on the way: the same box, grey bars where the words go. */
export function WzKpiCardSkeleton({ tone = "ink", className }: { tone?: WzKpiTone; className?: string }) {
  return (
    <div
      data-testid="wz-kpi-card-skeleton"
      aria-hidden
      className={cn(BOX, RULE[tone], "flex flex-col items-end bg-background", className)}
    >
      <Skeleton className="h-[25px] w-28" />
      <Skeleton className="mt-2 h-4 w-36" />
    </div>
  );
}
