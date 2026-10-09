import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * Workiz's Reports hub (`/root/_reports?view=workiz-reports`,
 * rep_hub_wz_01_default / _02_hover_jobs / _06_width*): a Developr grid of
 * `.card.widget.left-green` links, each in a `.c_hover` column.
 */

/**
 * `.columns.with-padding` — Developr's grid: pulled 2.25% left, 20px in all
 * round; the last row's bottom margin taken back (-20px, -25px from 1200px).
 */
const GRID = "ml-[-2.25%] mb-[-20px] flex flex-wrap content-start p-5 min-[1200px]:mb-[-25px]";

/**
 * A `four-columns six-columns-tablet twelve-columns-mobile` column: 2.25% to
 * its left; one to a row (97.75%) under 768px, two (47.75%) to 1199px, three
 * (31.0833%) from 1200px; 20px under it, 25px from 1200px.
 */
const COLUMN =
  "ml-[2.25%] mb-5 w-[97.75%] min-[768px]:w-[47.75%] min-[1200px]:mb-[25px] min-[1200px]:w-[31.0833%]";

/**
 * `.c_hover:hover` — the column drops a shadow under the card (.3s); ours
 * does the same on keyboard focus (Workiz draws no focus at all). Written out
 * in full so Tailwind sees the classes.
 */
const LIFT =
  "transition-[box-shadow,transform] duration-300 hover:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4)] has-[:focus-visible]:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4)]";

/**
 * `.card.widget.left-green`: a 3px ink rule on the left, 1px corners, 15px in
 * (46px tall with the 16px title), Workiz's two-part card shadow.
 */
const CARD =
  "rounded-[1px] border-l-[3px] border-l-foreground p-[15px] shadow-[0_1px_3px_rgba(0,0,0,0.16),0_2px_10px_rgba(0,0,0,0.12)]";

/** The grid of hub cards — a list, named for screen readers. */
export function WzHubGrid({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label": string;
}) {
  return (
    <ul aria-label={ariaLabel} data-slot="wz-hub-grid" className={cn(GRID, className)}>
      {children}
    </ul>
  );
}

/**
 * One hub card: a link named by its title. The title is `h5.cardTitle`
 * (16px/16px 500 ink); the glyph is `i.cardBigIcon` (30px #404040, floated
 * right 5px short of the padding and lifted 5px).
 */
export function WzHubCard({ href, title, icon: Icon }: { href: string; title: string; icon: LucideIcon }) {
  return (
    <li className={cn(COLUMN, LIFT, "cursor-pointer")}>
      <Link href={href} data-slot="wz-hub-card" className={cn(CARD, "relative block outline-none")}>
        <span data-slot="wz-hub-card-title" className="block pr-[35px] text-base leading-4 font-medium text-foreground">
          {title}
        </span>
        {/* Workiz's glyph box is 30×30, 10px down and 20px in from the right,
            and its Linearicons ink fills it edge to edge (28–31px). Lucide
            leaves 2/24 of air round its ink, so the svg is 34px on the same
            centre, with a 1.9px stroke to match Workiz's weight. */}
        <Icon
          aria-hidden="true"
          size={34}
          strokeWidth={1.35}
          className="absolute top-2 right-[18px] size-[34px] text-wz-strong"
        />
      </Link>
    </li>
  );
}

/** The same card, grey, while the hub waits for the viewer's role. */
export function WzHubCardSkeleton() {
  return (
    <li className={COLUMN}>
      <div data-testid="wz-hub-card-skeleton" aria-hidden className={cn(CARD, "h-[46px]")}>
        <Skeleton className="h-4 w-32 rounded-[2px]" />
      </div>
    </li>
  );
}
