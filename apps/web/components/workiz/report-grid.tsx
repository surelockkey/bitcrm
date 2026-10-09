"use client";

import { Fragment, type ReactNode } from "react";

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
  /**
   * Classes for the header's words, over the usual left-aligned 500: the
   * Items report's "Item" is react-table's plain header, centred and regular
   * (`"text-center font-normal"`, rep_items_wz_01_loaded).
   */
  headerClassName?: string;
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
const HEAD = "h-[42px] border-b border-r border-input bg-muted px-2.5 text-sm leading-[21px] font-medium text-wz-strong last:border-r-0";
const STICKY = "sticky top-0 z-10";
const CELL = "overflow-hidden border-r border-dotted border-table-border p-5 align-top text-sm leading-4 whitespace-nowrap text-wz-strong last:border-r-0";

/**
 * A record's box (`renderExpanded`): one cell across every column, white over
 * the zebra, no hover, no padding of its own. A hidden row follows it so the
 * body's `tr:nth-child(odd)` zebra still counts records — react-table puts
 * the box inside the record's rt-tr-group, so its stripes never shift.
 */
function ExpandedRow({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <>
      <TableRow data-slot="wz-report-grid-expanded" className="border-0 hover:bg-transparent">
        <TableCell colSpan={columns} className="border-0 bg-background p-0 align-top whitespace-normal">
          {children}
        </TableCell>
      </TableRow>
      <tr aria-hidden hidden />
    </>
  );
}

/** react-table's `-padRow`s, keeping the zebra going. */
function PadRows({ count, columns, rule = true }: { count: number; columns: number; rule?: boolean }) {
  return (
    <>
      {Array.from({ length: Math.max(0, count) }, (_, i) => (
        <TableRow key={`pad-${i}`} aria-hidden className="border-0 hover:bg-transparent">
          {Array.from({ length: columns }, (_, c) => (
            <TableCell
              key={c}
              className={cn(CELL, rule ? "h-[57px] border-b border-b-black/5 py-0 [border-bottom-style:solid]" : "h-[56px] py-0")}
            />
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
  renderExpanded,
  minRows = MIN_ROWS,
  stickyHeader = true,
  padRowRule = true,
  plainFiller = false,
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
  /**
   * What opens under a record (react-table's SubComponent — the Items
   * report's jobs of an item); `null` leaves the record closed. A record
   * holding an open `aria-expanded` control keeps its own background.
   */
  renderExpanded?: (row: R) => ReactNode;
  /** react-table's `minRows` (10; the Items report's drill-down asks 5). */
  minRows?: number;
  /** The header sticks to the top of the scrolling page (off for a grid nested in another). */
  stickyHeader?: boolean;
  /**
   * The blank rows' faint rule (57px over 1px rgba(0,0,0,.05), the Activity
   * report's). Off: 56px with no rule, as the Items report draws them
   * (rep_items_wz_11_empty_search).
   */
  padRowRule?: boolean;
  /**
   * Blanks UNDER records as Workiz's Tax report draws them: 56px, no rule —
   * while an empty grid keeps the rule (rep_tax_wz_01_default vs
   * rep_tax_wz_11b_search_empty). Off by default.
   */
  plainFiller?: boolean;
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
                <TableHead key={c.id} sort={dir} className={cn(HEAD, stickyHeader && STICKY)}>
                  {c.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.id)}
                      aria-label={`Sort by ${c.label}`}
                      className={cn("block w-full cursor-pointer truncate text-left font-medium", c.headerClassName)}
                    >
                      {c.label}
                    </button>
                  ) : (
                    <span className={cn("block truncate", c.headerClassName)}>{c.label}</span>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(busy && "opacity-60")}>
          {shown.map((row) => {
            const box = renderExpanded?.(row);
            return (
              <Fragment key={rowKey(row)}>
                {/* An open ▸ is not a selection: the record keeps its stripe. */}
                <TableRow className={cn("border-0", renderExpanded && "has-aria-expanded:bg-transparent")}>
                  {columns.map((c) => (
                    <TableCell key={c.id} className={CELL}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
                {box ? <ExpandedRow columns={columns.length}>{box}</ExpandedRow> : null}
              </Fragment>
            );
          })}
          <PadRows count={minRows - shown.length} columns={columns.length} rule={padRowRule && !(plainFiller && shown.length > 0)} />
        </TableBody>
      </Table>
      {loading ? (
        <div role="status" aria-label="Loading" className="absolute inset-0 z-20 bg-white/80">
          {/* Workiz's dots sit halfway down the whole grid: 340px on ten rows, the middle on fewer. */}
          <div className={cn("absolute left-1/2 flex -translate-x-1/2 gap-2", minRows === MIN_ROWS ? "top-[340px]" : "top-1/2 -translate-y-1/2")}>
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
