import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface WzDataTableColumn {
  key: string;
  label: string;
}

export interface WzDataTableRow {
  key: string;
  cells: ReactNode[];
}

/**
 * The legacy pages' DataTables grid (Job Statistics' tables:
 * rep_jobstats_wz_10_sources, _10_sources_sorted / _th_hover,
 * _12_area_metro_full, _15_empty_sources). Everything left-aligned.
 *
 * - Header: 14px/16px medium #666 capitalised, 15px 18px, 1px #ccc boxes,
 *   #0059a0 under the mouse; the sorted one starts with a small #666 ▼ (▲
 *   descending).
 * - Rows: 13px/16px #666, 20px 10px 20px 20px, a 1px #e6e6e6 rule above, a
 *   1px dotted #cfcfcf one on the left; the sorted column's cells #f1f1f1.
 *   No hover, no paging.
 * - Footer (Totals): 14px/16px #666, 15px 18px, 1px #ccc boxes.
 * - Empty: "No Records Found", 15px/500, centred.
 * - `search`: DataTables' filter strip over the table — 52px of #f7f7f7 and
 *   a 200×32 white "search" box (1px #e0e0e0) 10px from the right.
 */
export function WzDataTable({
  columns,
  rows,
  footer,
  sort,
  onSort,
  search,
  className,
  "aria-label": ariaLabel,
}: {
  columns: readonly WzDataTableColumn[];
  rows: readonly WzDataTableRow[];
  /** The Totals row, one cell per column. */
  footer?: readonly ReactNode[];
  /** The sorted column; null when the rows stand in the server's order. */
  sort: { key: string; dir: "asc" | "desc" } | null;
  onSort: (key: string) => void;
  search?: { value: string; onChange: (value: string) => void };
  className?: string;
  "aria-label": string;
}) {
  const sortedAt = sort ? columns.findIndex((c) => c.key === sort.key) : -1;
  return (
    <div className={cn("border-t border-input bg-muted", className)}>
      {search ? (
        <div className="flex h-[52px] items-center justify-end px-2.5">
          <input
            type="search"
            aria-label="Search"
            placeholder="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            // #e0e0e0: the DataTables filter box (rep_jobstats_wz_12_area_metro_full).
            className="h-8 w-[200px] border border-[#e0e0e0] bg-background px-[9px] text-sm text-wz-text outline-none placeholder:text-wz-placeholder focus:border-wz-focus [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      ) : null}
      {/* A narrow window scrolls the grid sideways, as DataTables' responsive table does. */}
      <div className="overflow-x-auto">
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
                    key={c.key}
                    scope="col"
                    aria-sort={
                      on
                        ? sort!.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className="border border-input p-0 text-left align-middle text-sm leading-4 font-medium capitalize"
                  >
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      className="flex w-full cursor-pointer items-center px-[18px] py-[15px] text-left capitalize outline-none hover:text-[#0059a0] focus-visible:text-[#0059a0]"
                    >
                      {on ? (
                        <span
                          aria-hidden
                          className="mr-[5px] ml-px text-[8px] leading-none"
                        >
                          {sort!.dir === "asc" ? "▼" : "▲"}
                        </span>
                      ) : null}
                      {c.label}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="h-[83px] text-center text-[15px] leading-4 font-medium"
                >
                  No Records Found
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key}>
                  {r.cells.map((cell, i) => (
                    <td
                      key={columns[i]?.key ?? i}
                      className={cn(
                        "border-t border-l border-t-[#e6e6e6] border-l-table-border pt-5 pr-2.5 pb-5 pl-5 align-top text-[13px] leading-4 [border-left-style:dotted]",
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
          {footer ? (
            <tfoot>
              <tr>
                {footer.map((cell, i) => (
                  <td
                    key={columns[i]?.key ?? i}
                    className="border border-input px-[18px] py-[15px] text-sm leading-4"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
