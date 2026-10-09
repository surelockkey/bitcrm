"use client";

import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WzLegacyGridColumn {
  id: string;
  label: string;
  /** The server sorts by it (a click on the header). */
  sortable?: boolean;
}

export interface WzLegacyGridRow {
  key: string;
  cells: ReactNode[];
}

export interface WzLegacyGridProps {
  "aria-label": string;
  columns: readonly WzLegacyGridColumn[];
  rows: readonly WzLegacyGridRow[];
  /** The Totals row Workiz puts INSIDE the head, under the names — one cell per column. */
  totals?: readonly ReactNode[];
  /** The sorted column; `null` while the rows stand in the server's own order (nothing marked). */
  sort: { id: string; dir: "asc" | "desc" } | null;
  onSort: (id: string) => void;
  pageSize: number;
  pageSizes: readonly number[];
  onPageSize: (size: number) => void;
  search: string;
  onSearch: (value: string) => void;
  /** The round "Reload Results" button; left out without it. */
  onRefresh?: () => void;
  /** DataTables' line under the grid ("Showing 1 to 50 of 244 entries …"). */
  info: string;
  /** Absent = that button is disabled. */
  onPrevious?: () => void;
  onNext?: () => void;
  /** A page is on its way: DataTables' dots over the head, the rows stay. */
  busy?: boolean;
  className?: string;
}

/**
 * Finance Reporting's server-side DataTables grid (Commissions,
 * rep_commission_wz_04_lastweek, _05_*, _09_sorted_*, _10_*, _12_empty).
 *
 * - The band over it: #f7f7f7 under a 1px #ccc rule, 61px: "Show [50▾]
 *   entries" (14px/30px #404040, the browser's own select) at the left; at the
 *   right the round reload button (37×40, 1px #666, its "Reload Results" tip
 *   #536268) and the 200×32 "search" box (1px #e0e0e0, r2), 10px in.
 * - The grid, wider than the page when its columns need it (it scrolls
 *   sideways): names 14px/16px 500 #666 capitalised, 15px 18px, 1px #ccc
 *   boxes, never wrapped, #0059a0 under the mouse, ▼/▲ before the sorted one;
 *   the Totals row inside the head (14px, ink figures); rows 11px/12px #666,
 *   9px 5px, a 1px #e6e6e6 rule above and a dotted #cfcfcf one at the left,
 *   #f0f0f0 under the mouse, the sorted column #f1f1f1.
 * - The band under it: the line ("Showing …", 14px/30px, 10px in) and
 *   ◂◂ Previous | Next ▸▸ (30px, 1px #ddd, r4, a soft drop).
 * - No rows: "No Records Found" (15px/500) across the grid.
 */
export function WzLegacyGrid({
  "aria-label": ariaLabel,
  columns,
  rows,
  totals,
  sort,
  onSort,
  pageSize,
  pageSizes,
  onPageSize,
  search,
  onSearch,
  onRefresh,
  info,
  onPrevious,
  onNext,
  busy = false,
  className,
}: WzLegacyGridProps) {
  const sortedAt = sort ? columns.findIndex((c) => c.id === sort.id) : -1;
  return (
    <div className={cn("relative border-t border-input bg-muted text-wz-strong", className)}>
      <div className="flex h-[61px] items-center justify-between pr-2.5 pl-2.5">
        <label className="flex items-center gap-[5px] text-sm leading-[30px] tracking-[0.4px]">
          Show
          <select
            aria-label="Show entries"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            // The browser's own select, as DataTables leaves it (#767676 edge, 13.86px #444).
            className="h-5 w-[42px] cursor-pointer border border-wz-native-check bg-background text-[13.86px] text-[#444444]"
          >
            {pageSizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          entries
        </label>
        <div className="flex items-center gap-[15px]">
          {onRefresh ? (
            <span className="group relative">
              <button
                type="button"
                aria-label="Reload Results"
                onClick={onRefresh}
                className="flex h-10 w-[37px] cursor-pointer items-center justify-center rounded-full border border-wz-text text-wz-text outline-none focus-visible:ring-1 focus-visible:ring-wz-strong"
              >
                <RotateCw aria-hidden className="size-5" strokeWidth={1.75} />
              </button>
              <span
                aria-hidden
                // #536268: the tip Workiz shows on the button (rep_commission_wz_02_refresh_hover).
                className="pointer-events-none absolute bottom-[50px] left-1/2 hidden -translate-x-1/2 rounded-[2px] bg-[#536268] px-2 py-1.5 text-sm leading-4 whitespace-nowrap text-white shadow-[0_3px_6px_rgba(0,0,0,0.18),0_4px_15px_rgba(0,0,0,0.15)] group-hover:block"
              >
                Reload Results
                <span className="absolute top-full left-1/2 -ml-[5px] border-x-[5px] border-t-[5px] border-x-transparent border-t-[#536268]" />
              </span>
            </span>
          ) : null}
          <input
            type="search"
            aria-label="Search"
            placeholder="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            // #e0e0e0: DataTables' filter box (rep_commission_wz_04_lastweek).
            className="h-8 w-[200px] rounded-[2px] border border-[#e0e0e0] bg-background px-[9px] py-[7px] text-sm leading-4 text-wz-text outline-none placeholder:text-wz-caption focus:border-wz-focus [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      </div>

      <div className="relative overflow-x-auto">
        {busy ? (
          <div role="status" aria-label="Processing" className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 gap-1">
            <span className="size-1.5 animate-pulse rounded-full bg-wz-text" />
            <span className="size-1.5 animate-pulse rounded-full bg-wz-text [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-wz-text [animation-delay:300ms]" />
          </div>
        ) : null}
        <table
          aria-label={ariaLabel}
          className="w-full border-collapse border-r border-b border-r-table-border border-b-input bg-background tracking-[0.4px] text-wz-text [border-right-style:dotted]"
        >
          <thead>
            <tr>
              {columns.map((c, i) => {
                const on = i === sortedAt;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                    className="border border-input p-0 text-left align-middle text-sm leading-4 font-medium whitespace-nowrap capitalize"
                  >
                    {c.sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.id)}
                        className="flex w-full cursor-pointer items-center px-[18px] py-[15px] text-left whitespace-nowrap capitalize outline-none hover:text-[#0059a0] focus-visible:text-[#0059a0]"
                      >
                        {on ? (
                          <span aria-hidden className="mr-[5px] ml-px text-[8px] leading-none">
                            {sort!.dir === "asc" ? "▼" : "▲"}
                          </span>
                        ) : null}
                        {c.label}
                      </button>
                    ) : (
                      <span className="block px-[18px] py-[15px]">{c.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
            {totals ? (
              <tr>
                {columns.map((c, i) => (
                  <td
                    key={c.id}
                    className="border border-input px-[18px] py-[15px] text-left align-middle text-sm leading-4 whitespace-nowrap text-foreground"
                  >
                    {totals[i]}
                  </td>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="h-[78px] text-center text-[15px] leading-4 font-medium text-wz-strong">
                  No Records Found
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                // #f0f0f0 / #f1f1f1 / #e6e6e6: the row under the mouse, the sorted column, the rule (rep_commission_wz_05_row_hover, _09_sorted_total).
                <tr key={r.key} className="hover:bg-[#f0f0f0]">
                  {r.cells.map((cell, i) => (
                    <td
                      key={columns[i]?.id ?? i}
                      className={cn(
                        "border-t border-l border-t-[#e6e6e6] border-l-table-border px-[5px] py-[9px] text-left align-top text-[11px] leading-3 [border-left-style:dotted]",
                        i === sortedAt && "bg-[#f1f1f1]",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pr-2.5">
        <p className="p-2.5 text-sm leading-[30px] tracking-[0.4px]">{info}</p>
        <div className="flex">
          <PageButton label="Previous" onClick={onPrevious} side="left" />
          <PageButton label="Next" onClick={onNext} side="right" />
        </div>
      </div>
    </div>
  );
}

/** DataTables' two_button pager: ◂◂ Previous | Next ▸▸. */
function PageButton({ label, onClick, side }: { label: string; onClick?: () => void; side: "left" | "right" }) {
  const arrows = (
    <svg aria-hidden viewBox="0 0 10 8" className={cn("h-2 w-2.5 fill-current", side === "right" && "rotate-180")}>
      <polygon points="5,0 5,8 0,4" />
      <polygon points="10,0 10,8 5,4" />
    </svg>
  );
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex h-[30px] cursor-pointer items-center gap-[5px] border border-wz-frame px-[11px] text-[13px] leading-7 tracking-[0.4px] text-wz-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_1px_rgba(0,0,0,0.25)] outline-none focus-visible:ring-1 focus-visible:ring-wz-strong disabled:cursor-default",
        side === "left" ? "rounded-l-[4px]" : "-ml-px rounded-r-[4px]",
      )}
    >
      {side === "left" ? arrows : null}
      {label}
      {side === "right" ? arrows : null}
    </button>
  );
}
