"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The Map before its board is in — the page's own shape, grey where the
 * words will be, in place of the bare spinner that stood there for the 5–15 s
 * the open jobs take to drain (app_audit 2026-10-09, finding 6).
 *
 * The 386px sidebar as `MapSidebar` draws it: the Search box with the Filter
 * glyph beside it, the Jobs | Techs switch (when the reader has the team),
 * the description line, "Found …" with Refresh, the two display toggles and
 * six card places of three lines each; beside it the map's frame with the
 * date box over its top. The board then draws over it at the same size, in
 * one frame — the house rule: one skeleton, then the page.
 */
export function DispatchBoardSkeleton({ showTabs = true }: { showTabs?: boolean }) {
  return (
    <div
      data-testid="dispatch-board-skeleton"
      role="status"
      aria-label="Loading the map"
      aria-busy="true"
      className="flex min-h-0 flex-1 bg-white pt-[14px]"
    >
      <aside data-testid="map-sidebar-skeleton" className="flex w-[386px] shrink-0 flex-col">
        <div className="flex items-center justify-between border-b border-border">
          <div className="min-w-0 flex-1 p-3">
            <Skeleton className="h-10 w-full rounded-[4px]" />
          </div>
          <div className="pr-2.5">
            <Skeleton className="size-9 rounded-[8px]" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col border-b border-border px-[9px] py-3">
          {showTabs ? <Skeleton className="h-[43px] w-full rounded-[4px]" /> : null}
          <div className={cn("-mx-[9px] min-h-0 flex-1 overflow-hidden", showTabs && "mt-3")}>
            <div className="border-b border-border px-4 pt-1 pb-3">
              <Skeleton className="h-[21px] w-[300px] max-w-full" />
            </div>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <Skeleton className="h-[19px] w-[190px]" />
              <Skeleton className="h-6 w-[88px]" />
            </div>
            {["techs", "areas"].map((row) => (
              <div key={row} className="mt-[15px] flex justify-between border-b border-border px-2.5 pb-3">
                <Skeleton className="ml-[5px] h-4 w-[130px]" />
                <Skeleton className="h-4 w-8 rounded-[8px]" />
              </div>
            ))}
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2 border-b border-border p-4">
                <Skeleton className="h-4 w-[210px]" />
                <Skeleton className="h-4 w-[270px]" />
                <Skeleton className="h-5 w-[72px] rounded-[4px]" />
              </div>
            ))}
          </div>
        </div>
      </aside>
      <div data-testid="map-skeleton" className="relative min-w-0 flex-1 bg-muted">
        <div aria-hidden className="absolute inset-x-0 top-[15px] z-10 mx-auto h-[62px] max-w-[584px] rounded-[8px] bg-white" />
      </div>
    </div>
  );
}
