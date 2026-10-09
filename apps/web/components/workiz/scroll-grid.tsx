"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Table, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A column of the grid: its minimum width (Workiz's react-table `minWidth`)
 * and whether it keeps it. A column without `fixed` grows when the page is
 * wider than the columns together, in proportion to its minimum — the way
 * react-table's `flex: <minWidth> 0 auto` shares the room (callspage_wz_01 at
 * 1600 against the 1440 probe: Status / From / Call Flow / Answered By kept
 * 70 / 160 / 180 / 180, the rest grew by the same 23 %). A column the reader
 * has dragged is `fixed` too: it holds the width they gave it.
 */
export interface WzScrollColumn {
  id: string;
  /** Named for the rows' own header (read, not seen) and for the resize handle. */
  label?: string;
  width: number;
  fixed?: boolean;
}

/**
 * The width each column is drawn at on a page `available` px wide: the
 * minimums when the page is narrower than they are together (the grid then
 * scrolls sideways) or not yet measured (0), else the growing columns share
 * the rest in proportion to their minimums. Fractions are kept — the browser
 * lays out sub-pixel column widths, and rounding each would drift the total.
 */
export function fitColumnWidths(columns: readonly WzScrollColumn[], available: number): Record<string, number> {
  const widths = Object.fromEntries(columns.map((c) => [c.id, c.width]));
  const total = columns.reduce((sum, c) => sum + c.width, 0);
  const extra = available - total;
  if (extra <= 0) return widths;
  const growing = columns.filter((c) => !c.fixed);
  const base = growing.reduce((sum, c) => sum + c.width, 0);
  if (base <= 0) return widths;
  for (const c of growing) widths[c.id] = c.width + (extra * c.width) / base;
  return widths;
}

/** Workiz's 1px #ddd frame around the grid. */
const FRAME = "relative border border-wz-frame";
/** Separate borders: the pinned header keeps its rules while the rows go under it. */
const TABLE = "table-fixed border-separate border-spacing-0";

/**
 * A grid that fills the page and scrolls sideways inside its own box, as
 * Workiz's react-table does (the 2026-10-09 probes of /root/callsReport/ at
 * 1280 and 1440: the document scrolls only up and down, the rows' box
 * sideways; callspage_wz_02_scroll1: the header stays at the page's top and
 * moves sideways with the rows).
 *
 * The header is one table and the rows another, on the same `<colgroup>`:
 * the header's box is `sticky top-0` in the page's scroller (so it pins) and
 * clips sideways; the rows' box is the only sideways scroller, and scrolling
 * it scrolls the header's box the same amount. The rows' table carries the
 * column names once more for a screen reader (`sr-only` — out of layout, so
 * `table-fixed` still takes its widths from the colgroup).
 *
 * Column widths come from `fitColumnWidths` on the frame's own inner width,
 * measured before the first paint (`useLayoutEffect`) and kept current, so
 * the first frame already has the final columns and nothing moves after it.
 * Until the frame is measured — the server's render, a test — the table
 * takes the frame's full width.
 *
 * A page using it scrolls only up and down (`overflow-y-auto
 * overflow-x-hidden`), so the controls above the grid hold still without
 * `sticky left-0` (which cannot hold a row as wide as its parent).
 */
export function WzScrollGrid({
  columns,
  header,
  children,
  after,
  busy,
  className,
  tableClassName,
  ...rest
}: Omit<React.ComponentProps<"div">, "children"> & {
  columns: readonly WzScrollColumn[];
  /** The header cells, handed the width each column is drawn at. */
  header: (widthOf: (id: string) => number) => ReactNode;
  /** The rows: a `<TableBody>` (and whatever else belongs inside the table). */
  children: ReactNode;
  /** Drawn over the rows, inside the frame: an empty wash, a quick view, a dialog. */
  after?: ReactNode;
  busy?: boolean;
  tableClassName?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);

  // Measured before the browser paints, and again whenever the frame's width
  // changes (the sidebar collapsing, the window resizing).
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const widths = fitColumnWidths(columns, available);
  const widthOf = (id: string) => widths[id] ?? 0;
  const total = columns.reduce((sum, c) => sum + widthOf(c.id), 0);
  const tableStyle = { width: available > 0 ? total : "100%" };
  const colgroup = (
    <colgroup>
      {columns.map((c) => (
        <col key={c.id} style={{ width: widthOf(c.id) }} />
      ))}
    </colgroup>
  );

  return (
    <div ref={frameRef} data-slot="wz-scroll-grid" className={cn(FRAME, className)} aria-busy={busy || undefined} {...rest}>
      <div ref={headRef} data-slot="wz-scroll-grid-head" className="sticky top-0 z-10 overflow-hidden">
        <Table className={cn(TABLE, tableClassName)} contained={false} style={tableStyle}>
          {colgroup}
          <TableHeader>
            <TableRow>{header(widthOf)}</TableRow>
          </TableHeader>
        </Table>
      </div>
      <div
        data-slot="wz-scroll-grid-body"
        className="overflow-x-auto"
        onScroll={(e) => {
          if (headRef.current) headRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
      >
        <Table className={cn(TABLE, tableClassName)} contained={false} style={tableStyle}>
          {colgroup}
          <thead className="sr-only">
            <tr>
              {columns.map((c) => (
                <th key={c.id} scope="col">
                  {c.label ?? c.id}
                </th>
              ))}
            </tr>
          </thead>
          {children}
        </Table>
      </div>
      {after}
    </div>
  );
}
