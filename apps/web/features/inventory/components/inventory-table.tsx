"use client";

import { useMemo, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { Skeleton } from "@/components/ui/skeleton";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";
import { TableFrame } from "./table-frame";

/** One column: its id (the saved width's key), its header and the width it starts at. */
export interface InventoryColumn {
  id: string;
  label: string;
  width: number;
}

/**
 * The height of an inventory row — the 32px buttons of the Actions cell plus
 * the cell's padding. Real rows and skeleton rows both carry it, so the table
 * is as tall loading as it is loaded.
 */
export const INVENTORY_ROW = "h-12";

/**
 * The frame every inventory list is drawn in, loading or loaded.
 *
 * The skeleton is not a picture of a table — it is this table, with the same
 * `<colgroup>`, the same header and a page's worth of rows as tall as the
 * real ones. So when the rows land nothing moves: not the columns, not the
 * pagination bar under it, not the page's scroll height.
 *
 * `stale` is `keepPreviousData` at work: the previous filter's rows stay on
 * screen, dimmed, while the new ones load — instead of collapsing the page to
 * a skeleton and back on every keystroke.
 */
export function InventoryTable({
  tableKey,
  columns,
  loading = false,
  skeletonRows = 0,
  stale = false,
  rowClassName = INVENTORY_ROW,
  children,
}: {
  /** Where the reader's column widths are saved. */
  tableKey: string;
  columns: InventoryColumn[];
  loading?: boolean;
  /** How many rows the skeleton has — the page size, so the page is its final height. */
  skeletonRows?: number;
  stale?: boolean;
  /** The height the table's own rows have, when taller than `INVENTORY_ROW`. */
  rowClassName?: string;
  children?: ReactNode;
}) {
  const defaults = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, c.width])), [columns]);
  const { widthOf, setWidth, reset } = useColumnWidths(tableKey, defaults);

  return (
    <TableFrame>
      {/* `table-fixed`: the column decides its width, not the longest value in
          it — and the reader can drag the edge. The frame scrolls sideways,
          so the table keeps no scroller of its own. */}
      <Table className="table-fixed" contained={false} aria-busy={loading || stale || undefined}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <ResizableHead
                key={c.id}
                columnId={c.id}
                label={c.label}
                width={widthOf(c.id)}
                onResize={(px) => setWidth(c.id, px)}
                onReset={reset}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(stale && "opacity-60 transition-opacity")}>
          {loading ? <SkeletonRows columns={columns.length} rows={skeletonRows} className={rowClassName} /> : children}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

/** A page of placeholder rows: one bar per cell, at the real rows' height. */
export function SkeletonRows({
  columns,
  rows,
  className = INVENTORY_ROW,
}: {
  columns: number;
  rows: number;
  className?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r} data-testid="skeleton-row" className={cn(className, "hover:bg-transparent")}>
          {Array.from({ length: columns }).map((_, c) => (
            <TableCell key={c} className="overflow-hidden">
              <Skeleton className={cn("h-4", c === 0 ? "w-3/4" : "w-1/2")} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
