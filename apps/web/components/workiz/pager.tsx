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
  /** The page count is at least this many ("of 200+"). */
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
 * The counts print raw ("4641"), as react-table prints them on every Workiz
 * list (app_audit 2026-10-09: "370338", "8806", "78617" — never a
 * separator); `plainNumbers: false` groups them for a list that wants that.
 */
export function wzPagerSummary(
  { from, to, total, totalIsFloor }: Pick<WzPagerState, "from" | "to" | "total" | "totalIsFloor">,
  { plainNumbers = true }: { plainNumbers?: boolean } = {},
): string {
  const n = plainNumbers ? plain : grouped;
  const start = to === 0 ? 1 : from;
  const of = typeof total === "number" ? ` of ${n(total)}${totalIsFloor ? "+" : ""}` : "";
  return `Showing ${n(start)} to ${n(to)}${of} results`;
}

/** "Page 1 of 881" — at least "of 1"; just "Page 3" when nobody counted. */
export function wzPagerPages(
  { page, totalPages, totalPagesIsFloor }: Pick<WzPagerState, "page" | "totalPages" | "totalPagesIsFloor">,
  { plainNumbers = true }: { plainNumbers?: boolean } = {},
): string {
  const n = plainNumbers ? plain : grouped;
  if (totalPages === undefined) return `Page ${n(page)}`;
  return `Page ${n(page)} of ${n(Math.max(totalPages, 1))}${totalPagesIsFloor ? "+" : ""}`;
}

/**
 * Whether › goes anywhere, for a list whose count knows its last page (the
 * jobs list, My jobs): on the counted last page Next rests even when the
 * server still hands back a cursor (audit L8 — "Page 2 of 1": a filtered
 * page came back short with a cursor past the counted end); without a
 * count, or with only a floor, the cursor decides. Such a list passes
 * `{ ...pager, canNext: wzPagerCanNext(pager) }`; `WzPager` itself follows
 * `canNext` as given, because other lists (calls, invoices, transfers) page
 * past counts that understate their pages.
 */
export function wzPagerCanNext({
  page,
  canNext,
  isFetching,
  totalPages,
  totalPagesIsFloor,
}: Pick<WzPagerState, "page" | "canNext" | "isFetching" | "totalPages" | "totalPagesIsFloor">): boolean {
  if (!canNext || isFetching) return false;
  if (typeof totalPages === "number" && !totalPagesIsFloor) return page < totalPages;
  return true;
}

/** Workiz's round ‹ › : a 30px #fafafa disc, never faded on the first page. */
const DISC =
  "grid size-[30px] place-items-center rounded-full bg-wz-disc text-wz-strong outline-none hover:bg-wz-disc-hover focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-wz-disc";

/**
 * Workiz's list footer (react-table `.pagination-bottom`): a 64px bar with a
 * 2px rgba(0,0,0,.1) top edge and a soft 15px glow; the summary 10px in at
 * the left; in the middle a 238px block centred on the bar — ‹ at its left
 * end, › at its right, "Page 1 of 5" centred between them, so the discs
 * stay put whatever the count says (list_07_bottom and uikit_wz_est_scroll1:
 * discs at 781 and 989 on the 200–1600 column for "of 5" and "of 881"
 * alike). Cursor-paged lists cannot jump to page 7, and neither can
 * Workiz's footer — no page numbers.
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
  plainNumbers = true,
  className,
}: {
  pager: WzPagerState;
  end?: ReactNode;
  loading?: boolean;
  /** Draw ‹ ›. Off for a list that cannot page (a read-only view stays button-free). */
  nav?: boolean;
  /**
   * Print the counts as react-table does, without thousands separators
   * ("4392") — on by default, as on every Workiz list; `false` groups them.
   */
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
        <div className="flex w-[238px] items-center justify-between md:absolute md:left-1/2 md:-translate-x-1/2">
          {nav ? (
            <button type="button" aria-label="Previous page" disabled={!pager.canPrev} onClick={() => pager.prev()} className={DISC}>
              <ChevronLeft className="size-[18px]" strokeWidth={1.5} />
            </button>
          ) : null}
          <span className="flex-1 text-center whitespace-nowrap tabular-nums">{wzPagerPages(pager, { plainNumbers })}</span>
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
