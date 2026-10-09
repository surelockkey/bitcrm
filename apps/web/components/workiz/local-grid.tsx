"use client";

import { useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { WzTableNoData } from "./no-data";
import { WzPager } from "./pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "./toolbar";

/** One column of a `WzLocalGrid`. */
export interface WzGridColumn<T> {
  id: string;
  label: string;
  /**
   * A fixed width in px (react-table's `maxWidth`: the Id column's 130).
   * Without it the column takes an equal share of the row, never under
   * Workiz's 100px — past that the grid scrolls sideways, as Workiz's does.
   */
  width?: number;
  render: (row: T) => ReactNode;
  /** What the header sorts by. Absent: the header does not sort. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** The words the Search box looks in. Absent: not searched. */
  searchText?: (row: T) => string | null | undefined;
  /** Extra classes for this column's cells (a link colour, a wrap). */
  cellClassName?: string;
}

export interface WzGridSort {
  id: string;
  dir: "asc" | "desc";
}

export interface WzGridView<T> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
  from: number;
  to: number;
}

const blank = (v: unknown) => v === undefined || v === null || v === "";

/**
 * The rows a client-side react-table shows: those the query finds in any
 * searchable column (any case), in the header's order — numbers as numbers,
 * words as words, blanks last whichever way — cut to the page. A page past
 * the end comes back to the last one.
 */
export function localGridView<T>(
  rows: readonly T[],
  columns: readonly WzGridColumn<T>[],
  { query, sort, page, size }: { query: string; sort: WzGridSort | null; page: number; size: number },
): WzGridView<T> {
  const q = query.trim().toLowerCase();
  let shown = q
    ? rows.filter((r) => columns.some((c) => c.searchText?.(r)?.toString().toLowerCase().includes(q)))
    : [...rows];
  const col = sort ? columns.find((c) => c.id === sort.id && c.sortValue) : undefined;
  if (col && sort) {
    const sign = sort.dir === "asc" ? 1 : -1;
    shown = [...shown].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (blank(va) || blank(vb)) return blank(va) === blank(vb) ? 0 : blank(va) ? 1 : -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
      return String(va).localeCompare(String(vb), "en", { numeric: true, sensitivity: "base" }) * sign;
    });
  }
  const total = shown.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, page), pages);
  const start = (at - 1) * size;
  const slice = shown.slice(start, start + size);
  return { rows: slice, total, page: at, pages, from: total === 0 ? 0 : start + 1, to: start + slice.length };
}

/** react-table's header click: a new column sorts ascending, the same one flips. */
export function nextGridSort(current: WzGridSort | null, id: string): WzGridSort {
  if (current?.id === id) return { id, dir: current.dir === "asc" ? "desc" : "asc" };
  return { id, dir: "asc" };
}

export const WZ_GRID_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;

/** Workiz pads a grid to ten rows (react-table `minRows`), 57px each. */
const MIN_ROWS = 10;
/** react-table's smallest column. */
const MIN_COL = 100;

/** rt-td: 20px all round, 14px/16px #404040, clipped with "…", a dotted rule between columns. */
const CELL = "overflow-hidden p-5 align-top text-ellipsis whitespace-nowrap";

/**
 * A Workiz report grid whose rows are all in hand — the client page's Jobs,
 * Estimates, Invoices, Payments, Addresses and Calls tabs
 * (pg_contact_wz_269669_*): the 71px #f7f7f7 strip with Search (and the
 * caller's `toolbar` pieces after it) and the page size (5…100, ten by
 * default) at the right; react-table's grid in a 1px #ddd frame — fixed
 * columns at their width, the rest sharing the row, never under 100px (past
 * that it scrolls sideways); headers that sort on click with the 3px bar;
 * rows padded to ten, "No Records Found" over them when there is nothing;
 * then Workiz's footer, "Showing 1 to 10 of 18 results" ‹ Page 1 of 2 ›.
 *
 * Search, sort and pages are worked out here (`localGridView`).
 */
export function WzLocalGrid<T>({
  label,
  columns,
  rows,
  rowKey,
  defaultSort = null,
  searchLabel = "Search",
  toolbar,
  onRowClick,
  rowClassName,
  footer,
  defaultPageSize = 10,
  pagerInside = false,
  emptyText = "No Records Found",
  search = true,
  className,
}: {
  /** The table's accessible name ("Jobs"). */
  label: string;
  columns: readonly WzGridColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  defaultSort?: WzGridSort | null;
  searchLabel?: string;
  /** Pieces after the Search box ("Pay unpaid invoices"). */
  toolbar?: ReactNode;
  /** The row opens something (Workiz's rows are links); gets the click for ⌘/Ctrl. */
  onRowClick?: (row: T, e: MouseEvent<HTMLTableRowElement>) => void;
  rowClassName?: string;
  /** Under the pager ("Still counting the client's jobs…"). */
  footer?: ReactNode;
  /** The page size the grid opens at (Workiz's settings grids: 10, Sub Status 50). */
  defaultPageSize?: number;
  /**
   * The pager inside the grid's 1px frame, as react-table's
   * `.pagination-bottom` sits on Workiz's settings pages (uikit_wz_set_jobtypes:
   * the frame runs down round the footer). Off: under the frame, as on the
   * client page.
   */
  pagerInside?: boolean;
  /**
   * What an empty grid says over its blank rows: words in react-table's
   * "No Records Found" band (the default), the caller's own block — Workiz
   * Phone's "No call groups created" (pg_settings_phone_wz_groups_search_empty)
   * — centred over the rows, or `null` for the blank rows alone (its numbers
   * and flows grids).
   */
  emptyText?: ReactNode;
  /**
   * `false`: no Search box and no page size — Workiz's Blocked callers grid
   * has neither (settings_audit_wz_blocked_callers_v4), only its empty 31px
   * strip (#f7f7f7, 1px #ddd over it) where the others put the Search.
   */
  search?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WzGridSort | null>(defaultSort);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(defaultPageSize);

  const view = useMemo(() => localGridView(rows, columns, { query, sort, page, size }), [rows, columns, query, sort, page, size]);
  const fixed = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  const flexible = columns.filter((c) => !c.width).length;
  const minWidth = fixed + flexible * MIN_COL;

  const pager = (
    <WzPager
      pager={{
        page: view.page,
        from: view.from,
        to: view.to,
        total: view.total,
        totalPages: view.pages,
        canPrev: view.page > 1,
        canNext: view.page < view.pages,
        isFetching: false,
        prev: () => setPage(view.page - 1),
        next: () => setPage(view.page + 1),
      }}
    />
  );

  return (
    <div data-slot="wz-local-grid" className={cn("flex min-w-0 flex-col", className)}>
      {search ? (
        <WzListToolbar>
          <WzSearchBox
            type="search"
            aria-label={searchLabel}
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />
          {toolbar}
          <WzPageSizeSelect
            className="ml-auto"
            value={size}
            sizes={WZ_GRID_PAGE_SIZES}
            onChange={(n) => {
              setSize(n);
              setPage(1);
            }}
          />
        </WzListToolbar>
      ) : (
        <div data-slot="wz-local-grid-strip" className="h-[31px] shrink-0 border-t border-wz-frame bg-muted" />
      )}
      <div data-slot="wz-local-grid-frame" className="relative overflow-x-auto border border-wz-frame">
        <Table aria-label={label} contained={false} className="table-fixed border-separate border-spacing-0" style={{ minWidth }}>
          <colgroup>
            {columns.map((c) => (
              <col key={c.id} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              {columns.map((c) => {
                const dir = sort?.id === c.id ? sort.dir : undefined;
                return (
                  <TableHead key={c.id} sort={dir} className="h-[42px] border-b border-input">
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSort((s) => nextGridSort(s, c.id));
                          setPage(1);
                        }}
                        className="block w-full truncate text-left outline-none focus-visible:underline"
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
          <TableBody>
            {view.rows.map((r) => (
              <TableRow
                key={rowKey(r)}
                className={cn("border-0", onRowClick && "cursor-pointer", rowClassName)}
                onClick={onRowClick ? (e) => onRowClick(r, e) : undefined}
                onAuxClick={onRowClick ? (e) => e.button === 1 && onRowClick(r, e) : undefined}
              >
                {columns.map((c) => (
                  <TableCell key={c.id} className={cn(CELL, c.cellClassName)}>
                    {c.render(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {Array.from({ length: Math.max(0, MIN_ROWS - view.rows.length) }, (_, i) => (
              <TableRow key={`pad-${i}`} aria-hidden className="h-[57px] border-0 hover:bg-transparent">
                {columns.map((c) => (
                  <TableCell key={c.id} className={CELL} />
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {view.total === 0 && emptyText !== null && emptyText !== undefined ? (
          typeof emptyText === "string" ? (
            <WzTableNoData>{emptyText}</WzTableNoData>
          ) : (
            <div
              data-slot="wz-local-grid-empty"
              role="status"
              className="pointer-events-none absolute top-[135px] left-1/2 z-10 w-[390px] max-w-full -translate-x-1/2 text-center"
            >
              {emptyText}
            </div>
          )
        ) : null}
        {pagerInside ? pager : null}
      </div>
      {pagerInside ? null : pager}
      {footer}
    </div>
  );
}
