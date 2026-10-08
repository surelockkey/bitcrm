"use client";

import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { WzTableNoData } from "./no-data";

/** One column of a report grid: its header, how a record fills its cell. */
export interface WzReportColumn<R> {
  id: string;
  label: string;
  /** react-table's share: a fixed px width; columns without one split the rest alike. */
  width?: number;
  /** The header orders the report (a button calling `onSort`). */
  sortable?: boolean;
  cell: (row: R) => ReactNode;
}

export type WzSortDir = "asc" | "desc";

/**
 * react-table's click on a header: an unsorted column sorts ascending, a
 * sorted one turns round (rep_activity_wz_08_sort_asc → _08b_sort_desc).
 */
export function wzNextSort(dir: WzSortDir | undefined): WzSortDir {
  return dir === "asc" ? "desc" : "asc";
}

/** react-table's `minRows` on Workiz's reports. */
const MIN_ROWS = 10;

/*
 * Workiz's report grid (react-table `-striped -highlight`), measured off
 * rep_activity_wz_06_yesterday / _01_today / _00_loading / _14_size100:
 *   frame   1px #ddd all round, the page's full width;
 *   header  42px on #f7f7f7 (41 + a 1px #ccc rule), 14px/500 #404040 10px in,
 *           solid #ccc rules between; sticks to the top of the scrolling page;
 *           the sorted column carries the 3px bar (top asc, foot desc);
 *   cells   20px all round, top-aligned, 14px/16px #404040, one line, cut at
 *           the cell's edge; dotted #cfcfcf rules; odd rows #f7f7f7, the row
 *           under the cursor rgba(0,0,0,.05); no rule between record rows;
 *   filler  blank rows up to ten, 56px each over a 1px rgba(0,0,0,.05) rule;
 *   empty   "No Records Found" (15px/500 on a white-70% band whose right edge
 *           is the grid's middle) 204px under the grid's top;
 *   loading the header and ten blank rows under a white-80% veil, three 13px
 *           ink dots 340px down the middle.
 */
const FRAME = "relative border border-wz-frame";
const TABLE = "table-fixed w-full border-separate border-spacing-0";
const HEAD = "sticky top-0 z-10 h-[42px] border-b border-r border-input bg-muted px-2.5 text-sm leading-[21px] font-medium text-wz-strong last:border-r-0";
const CELL = "overflow-hidden border-r border-dotted border-table-border p-5 align-top text-sm leading-4 whitespace-nowrap text-wz-strong last:border-r-0";

/** react-table's `-padRow`s, keeping the zebra going. */
function PadRows({ count, columns }: { count: number; columns: number }) {
  return (
    <>
      {Array.from({ length: Math.max(0, count) }, (_, i) => (
        <TableRow key={`pad-${i}`} aria-hidden className="border-0 hover:bg-transparent">
          {Array.from({ length: columns }, (_, c) => (
            <TableCell key={c} className={cn(CELL, "h-[57px] border-b border-b-black/5 py-0 [border-bottom-style:solid]")} />
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * A Workiz report's grid: the columns given, one row per record, never
 * shorter than ten rows, "No Records Found" when there is nothing, Workiz's
 * own loading veil while the first page is on its way. Sorting is the
 * caller's (the server's): a `sortable` header calls `onSort(column)`, and
 * `sort` says which column carries the bar (`null`: none — Workiz opens its
 * reports unsorted, newest first). It keeps no scroller: the page scrolls,
 * so the header can stick to the top.
 */
export function WzReportGrid<R>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  loading = false,
  busy = false,
  emptyText = "No Records Found",
  footer,
  "aria-label": ariaLabel,
  className,
}: {
  columns: readonly WzReportColumn<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  sort?: { column: string; dir: WzSortDir } | null;
  onSort?: (column: string) => void;
  /** The first page is still coming: header, blank rows and the loader. */
  loading?: boolean;
  /** Another page is coming over the rows on screen. */
  busy?: boolean;
  emptyText?: ReactNode;
  /** react-table's `.pagination-bottom`: the pager, inside the frame under the rows. */
  footer?: ReactNode;
  "aria-label"?: string;
  className?: string;
}) {
  const shown = loading ? [] : rows;
  return (
    <div data-slot="wz-report-grid" className={cn(FRAME, className)} aria-busy={loading || busy || undefined}>
      <Table contained={false} aria-label={ariaLabel} className={TABLE}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.id} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {columns.map((c) => {
              const dir = sort && sort.column === c.id ? sort.dir : undefined;
              return (
                <TableHead key={c.id} sort={dir} className={HEAD}>
                  {c.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.id)}
                      aria-label={`Sort by ${c.label}`}
                      className="block w-full cursor-pointer truncate text-left font-medium"
                    >
                      {c.label}
                    </button>
                  ) : (
                    <span className="block truncate">{c.label}</span>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(busy && "opacity-60")}>
          {shown.map((row) => (
            <TableRow key={rowKey(row)} className="border-0">
              {columns.map((c) => (
                <TableCell key={c.id} className={CELL}>
                  {c.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <PadRows count={MIN_ROWS - shown.length} columns={columns.length} />
        </TableBody>
      </Table>
      {loading ? (
        <div role="status" aria-label="Loading" className="absolute inset-0 z-20 bg-white/80">
          <div className="absolute top-[340px] left-1/2 flex -translate-x-1/2 gap-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-[13px] animate-pulse rounded-full bg-foreground"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </div>
        </div>
      ) : shown.length === 0 ? (
        <WzTableNoData className="top-[204px] right-1/2 left-auto translate-x-0 pr-1.5 pl-[26px]">{emptyText}</WzTableNoData>
      ) : null}
      {footer}
    </div>
  );
}
