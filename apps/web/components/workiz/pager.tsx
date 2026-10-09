"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The part of a `Pager` (lib/paging/use-pager) the footer reads. */
export interface WzPagerState {
  page: number;
  from: number;
  to: number;
  total?: number | null;
  totalIsFloor?: boolean;
  totalPages?: number;
  totalPagesIsFloor?: boolean;
  canPrev: boolean;
  canNext: boolean;
  isFetching: boolean;
  prev: () => void;
  next: () => Promise<void> | void;
}

const grouped = (v: number) => v.toLocaleString("en-US");
/** react-table's own printing: "4392", "370338" (rep_activity_wz_06). */
const plain = (v: number) => String(v);

/**
 * "Showing 1 to 50 of 208 results" (list_07_bottom, uikit_wz_est_scroll1).
 * An empty list reads "Showing 1 to 0 of 0 results", as Workiz's does; an
 * uncounted total is left out; a total that is only a floor gets a "+".
 * `plainNumbers` drops the thousands separators, as Workiz prints them.
 */
export function wzPagerSummary(
  { from, to, total, totalIsFloor }: Pick<WzPagerState, "from" | "to" | "total" | "totalIsFloor">,
  { plainNumbers = false }: { plainNumbers?: boolean } = {},
): string {
  const n = plainNumbers ? plain : grouped;
  const start = to === 0 ? 1 : from;
  const of = typeof total === "number" ? ` of ${n(total)}${totalIsFloor ? "+" : ""}` : "";
  return `Showing ${n(start)} to ${n(to)}${of} results`;
}

/** "Page 1 of 881" — at least "of 1"; just "Page 3" when nobody counted. */
export function wzPagerPages(
  { page, totalPages, totalPagesIsFloor }: Pick<WzPagerState, "page" | "totalPages" | "totalPagesIsFloor">,
  { plainNumbers = false }: { plainNumbers?: boolean } = {},
): string {
  const n = plainNumbers ? plain : grouped;
  if (totalPages === undefined) return `Page ${n(page)}`;
  return `Page ${n(page)} of ${n(Math.max(totalPages, 1))}${totalPagesIsFloor ? "+" : ""}`;
}

/** Workiz's round ‹ › : a 30px #fafafa disc, never faded on the first page. */
const DISC =
  "grid size-[30px] place-items-center rounded-full bg-wz-disc text-wz-strong outline-none hover:bg-wz-disc-hover focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-wz-disc";

/**
 * Workiz's list footer (react-table `.pagination-bottom`): a 64px bar with a
 * 2px rgba(0,0,0,.1) top edge and a soft 15px glow; the summary 10px in at
 * the left, ‹ "Page 1 of 5" › centred 50px apart. Cursor-paged lists cannot
 * jump to page 7, and neither can Workiz's footer — no page numbers.
 *
 * `end` sits at the right (our page-size select; Workiz keeps that in the
 * toolbar above the grid). `loading` keeps the bar at its height with a
 * placeholder where the numbers will be.
 */
export function WzPager({
  pager,
  end,
  loading = false,
  nav = true,
  plainNumbers = false,
  className,
}: {
  pager: WzPagerState;
  end?: ReactNode;
  loading?: boolean;
  /** Draw ‹ ›. Off for a list that cannot page (a read-only view stays button-free). */
  nav?: boolean;
  /** Print the counts as react-table does, without thousands separators ("4392"). */
  plainNumbers?: boolean;
  className?: string;
}) {
  return (
    <div
      data-testid="list-pagination"
      data-slot="wz-pager"
      aria-busy={loading || undefined}
      className={cn(
        "relative flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-black/10 px-2.5 py-3 text-sm leading-4 text-wz-strong shadow-[0_0_15px_rgba(0,0,0,0.1)]",
        className,
      )}
    >
      {/* Reserved width and fixed digits: " of 312" arrives with the count. */}
      <span className="min-w-[14rem] tabular-nums">{loading ? <Skeleton className="h-3.5 w-48" /> : wzPagerSummary(pager, { plainNumbers })}</span>
      {!loading ? (
        <div className="flex items-center gap-[50px] md:absolute md:left-1/2 md:-translate-x-1/2">
          {nav ? (
            <button type="button" aria-label="Previous page" disabled={!pager.canPrev} onClick={() => pager.prev()} className={DISC}>
              <ChevronLeft className="size-[18px]" strokeWidth={1.5} />
            </button>
          ) : null}
          <span className="min-w-[6.5rem] text-center whitespace-nowrap tabular-nums">{wzPagerPages(pager, { plainNumbers })}</span>
          {nav ? (
            <button
              type="button"
              aria-label="Next page"
              disabled={!pager.canNext || pager.isFetching}
              onClick={() => void pager.next()}
              className={DISC}
            >
              <ChevronRight className="size-[18px]" strokeWidth={1.5} />
            </button>
          ) : null}
        </div>
      ) : null}
      {end ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
    </div>
  );
}
