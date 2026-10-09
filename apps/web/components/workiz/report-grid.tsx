"use client";

import { Fragment, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { ResizableHead } from "@/components/ui/resizable-head";
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
 * Column widths the reader can drag (react-table's `rt-resizable-header`):
 * the caller keeps them (`useColumnWidths`), the grid draws the handles.
 */
export interface WzReportGridResize {
  widthOf: (column: string) => number;
  setWidth: (column: string, px: number) => void;
  /** Double-click or Home on a handle: back to the defaults. */
  reset?: () => void;
}

/** What opened a record: a click (⌘/Ctrl/middle for a new tab) or Enter on the focused row. */
export type WzRowOpenEvent = MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>;

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

/**
 * react-table's `-padRow`s, keeping the zebra going. Told the row `height`,
 * a blank takes the record cells' own classes (the same padding and
 * alignment) under that height; otherwise Workiz's 56/57px blank.
 *
 * Keyed by the slot a blank fills (`from` records before it), not by its
 * index: once the records are in, the blanks under them are the very rows
 * they were while loading, in the same places, and the records take the
 * places of the blanks they replace as new elements — so nothing the
 * browser can see moves (keyed by index, the blanks slid down by a record
 * row each; Chrome reported them, probe_shift 2026-10-09).
 */
function PadRows({
  count,
  columns,
  rule = true,
  height,
  cellAlign = "top",
  from = 0,
}: {
  count: number;
  columns: number;
  rule?: boolean;
  height?: number;
  cellAlign?: "top" | "middle";
  from?: number;
}) {
  const cell = height
    ? cn(CELL, cellAlign === "middle" && "align-middle", rule && "border-b border-b-black/5 [border-bottom-style:solid]")
    : cn(CELL, rule ? "h-[57px] border-b border-b-black/5 py-0 [border-bottom-style:solid]" : "h-[56px] py-0");
  return (
    <>
      {Array.from({ length: Math.max(0, count) }, (_, i) => (
        <TableRow
          key={`pad-${from + i}`}
          aria-hidden
          className="border-0 hover:bg-transparent"
          style={height ? { height } : undefined}
        >
          {Array.from({ length: columns }, (_, c) => (
            <TableCell key={c} className={cell} />
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
  onRowClick,
  resize,
  cellAlign = "top",
  minTableWidth,
  rowHeight,
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
  /** Over an empty report; `null` prints nothing (Call Tracking's blank rows stay silent). */
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
  /**
   * The whole record opens something (the Invoices list's `rt-tr-group
   * pointer`): a click anywhere on the row, a middle click, or Enter on the
   * focused row. Links inside the row should stop their own clicks.
   */
  onRowClick?: (row: R, event: WzRowOpenEvent) => void;
  /** The header edges can be dragged; the widths are the caller's. */
  resize?: WzReportGridResize;
  /**
   * Where a record's words sit in its cell: `"top"` (default, the reports'
   * rt-td) or `"middle"` — the Price book's grids, whose rt-td is
   * `display:flex; align-items:center` beside a 40px picture
   * (pg_pricebook_wz_01_default: 80px rows, every word on the middle).
   */
  cellAlign?: "top" | "middle";
  /**
   * The table never narrower than this: past the frame's width the rows
   * scroll sideways in their own box, the pager staying put under it —
   * Workiz's Inventory grid, twenty 100px columns (2030px) in a 1400px frame
   * (pg_inventory_wz_01_inventory). The header is then a table of its own in
   * a box pinned to the page's top (`stickyHeader`) that moves sideways with
   * the rows, as `WzScrollGrid` draws it — a sticky header inside the
   * sideways box was trapped by it (2026-10-09). Off by default: a grid
   * without it is one table, exactly as it was.
   */
  minTableWidth?: number;
  /**
   * A record row's height on this grid, in px. Workiz's rows are as tall as
   * what they hold — 56 for one 14px/16px line in 20px padding, 58 with the
   * Activity report's icon, 77 for the Items report's two lines, 80 beside a
   * 40px picture, 82 for a name over an email — while its loader's blank rows
   * are react-table's 56/57px, so the records land lower than the blanks
   * they replace and everything under them moves (app_audit 2026-10-09: CLS
   * 0.02–0.13 on twelve grids). Given, the loader's blanks, the records and
   * the blank filler under them all take it: the grid is the same height
   * before and after the rows come and nothing moves — the house rule, one
   * skeleton, then the page. A record taller than it still grows. Off by
   * default: a grid without it keeps Workiz's blanks as they were.
   */
  rowHeight?: number;
  "aria-label"?: string;
  className?: string;
}) {
  const shown = loading ? [] : rows;
  const rowStyle = rowHeight ? { height: rowHeight } : undefined;
  // Workiz's dots sit 340px down ten of its own 56/57px blanks; over taller rows, the grid's middle.
  const workizBlanks = minRows === MIN_ROWS && (rowHeight === undefined || rowHeight <= 57);
  const headRef = useRef<HTMLDivElement>(null);
  // Wider than its frame, the grid is two tables on the same columns: the
  // header in a pinned box, the rows in the one sideways scroller (as
  // `WzScrollGrid`); otherwise one table, as it always was.
  const split = Boolean(minTableWidth);
  const tableStyle = minTableWidth ? { minWidth: minTableWidth } : undefined;
  const colgroup = (
    <colgroup>
      {columns.map((c) => {
        const width = resize ? resize.widthOf(c.id) : c.width;
        return <col key={c.id} style={width ? { width } : undefined} />;
      })}
    </colgroup>
  );
  // In one table the header cells stick on their own; split, their box does.
  const headClass = cn(HEAD, stickyHeader && !split && STICKY);
  const header = (
    <TableHeader>
      <TableRow className="border-0 hover:bg-transparent">
        {columns.map((c) => {
          const dir = sort && sort.column === c.id ? sort.dir : undefined;
          const words =
            c.sortable && onSort ? (
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
            );
          return resize ? (
            <ResizableHead
              key={c.id}
              columnId={c.id}
              label={c.label}
              width={resize.widthOf(c.id)}
              onResize={(px) => resize.setWidth(c.id, px)}
              onReset={resize.reset}
              sort={dir}
              className={headClass}
            >
              {words}
            </ResizableHead>
          ) : (
            <TableHead key={c.id} sort={dir} className={headClass}>
              {words}
            </TableHead>
          );
        })}
      </TableRow>
    </TableHeader>
  );
  const body = (
      <TableBody className={cn(busy && "opacity-60")}>
        {shown.map((row) => {
          const box = renderExpanded?.(row);
          return (
            <Fragment key={rowKey(row)}>
              {/* An open ▸ is not a selection: the record keeps its stripe. */}
              <TableRow
                className={cn("border-0", renderExpanded && "has-aria-expanded:bg-transparent", onRowClick && "cursor-pointer")}
                style={rowStyle}
                {...(onRowClick && {
                  tabIndex: 0,
                  onClick: (e: MouseEvent<HTMLTableRowElement>) => onRowClick(row, e),
                  onAuxClick: (e: MouseEvent<HTMLTableRowElement>) => {
                    if (e.button === 1) onRowClick(row, e);
                  },
                  onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row, e);
                  },
                })}
              >
                {columns.map((c) => (
                  <TableCell key={c.id} className={cn(CELL, cellAlign === "middle" && "align-middle")}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
              {box ? <ExpandedRow columns={columns.length}>{box}</ExpandedRow> : null}
            </Fragment>
          );
        })}
        <PadRows
          count={minRows - shown.length}
          columns={columns.length}
          rule={padRowRule && !(plainFiller && shown.length > 0)}
          height={rowHeight}
          cellAlign={cellAlign}
          from={shown.length}
        />
      </TableBody>
  );
  const table = split ? (
    <>
      <div
        ref={headRef}
        data-slot="wz-report-grid-head"
        className={cn("overflow-hidden", stickyHeader && "sticky top-0 z-10")}
      >
        <Table contained={false} className={TABLE} style={tableStyle}>
          {colgroup}
          {header}
        </Table>
      </div>
      <div
        data-slot="wz-report-grid-body"
        className="overflow-x-auto"
        onScroll={(e) => {
          if (headRef.current) headRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
      >
        <Table contained={false} aria-label={ariaLabel} className={TABLE} style={tableStyle}>
          {colgroup}
          {/* The column names once more, for a screen reader; out of layout. */}
          <thead className="sr-only">
            <tr>
              {columns.map((c) => (
                <th key={c.id} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          {body}
        </Table>
      </div>
    </>
  ) : (
    <Table contained={false} aria-label={ariaLabel} className={TABLE}>
      {colgroup}
      {header}
      {body}
    </Table>
  );
  return (
    <div data-slot="wz-report-grid" className={cn(FRAME, className)} aria-busy={loading || busy || undefined}>
      {table}
      {loading ? (
        <div role="status" aria-label="Loading" className="absolute inset-0 z-20 bg-white/80">
          <div className={cn("absolute left-1/2 flex -translate-x-1/2 gap-2", workizBlanks ? "top-[340px]" : "top-1/2 -translate-y-1/2")}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-[13px] animate-pulse rounded-full bg-foreground"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </div>
        </div>
      ) : shown.length === 0 && emptyText !== null ? (
        <WzTableNoData className="top-[204px] right-1/2 left-auto translate-x-0 pr-1.5 pl-[26px]">{emptyText}</WzTableNoData>
      ) : null}
      {footer}
    </div>
  );
}
