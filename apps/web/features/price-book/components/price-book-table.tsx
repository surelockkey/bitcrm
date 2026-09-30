"use client";

import { useMemo, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { Skeleton } from "@/components/ui/skeleton";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";
import { TableFrame } from "@/features/inventory/components/table-frame";

/** One column: its id (the saved width's key), its header and the width it starts at. */
export interface PriceBookColumn<Id extends string = string> {
  id: Id;
  label: string;
  width: number;
  /** The shape its skeleton cell draws, when not a bar of text (a photo's square). */
  skeleton?: string;
}

/**
 * A row's height: the 32px buttons of the Actions cell plus the cell padding.
 * Real rows and skeleton rows both carry it, so the table is as tall loading
 * as it is loaded.
 */
export const ROW_HEIGHT = "h-12";

/**
 * The frame every Price Book list is drawn in, loading or loaded.
 *
 * The skeleton is this same table — the same `<colgroup>`, the same headers,
 * rows at the real rows' height — so nothing moves when the rows land.
 * `stale` is `keepPreviousData` at work: the previous filter's rows stay,
 * dimmed, while the new ones load. `empty` keeps the headers in place and
 * says so in a row, instead of swapping the table for a different box.
 *
 * Everything is left-aligned, money included — Workiz's grid.
 */
export function PriceBookTable({
  tableKey,
  columns,
  loading = false,
  skeletonRows = 0,
  stale = false,
  empty,
  children,
}: {
  /** Where the reader's column widths are saved. */
  tableKey: string;
  columns: PriceBookColumn[];
  loading?: boolean;
  skeletonRows?: number;
  stale?: boolean;
  /** Shown in one full-width row when there is nothing to list. */
  empty?: ReactNode;
  children?: ReactNode;
}) {
  const defaults = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.id, c.width])),
    [columns],
  );
  const { widthOf, setWidth, reset } = useColumnWidths(tableKey, defaults);

  return (
    <TableFrame>
      {/* `table-fixed`: the column decides its width, not the longest value
          in it — and the reader can drag the edge. */}
      <Table className="table-fixed" aria-busy={loading || stale || undefined}>
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
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, r) => (
              <TableRow key={r} data-testid="skeleton-row" className={cn(ROW_HEIGHT, "hover:bg-transparent")}>
                {columns.map((c, i) => (
                  <TableCell key={c.id} className="overflow-hidden">
                    <Skeleton className={c.skeleton ?? cn("h-4", i === 1 ? "w-3/4" : "w-1/2")} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : empty ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="overflow-hidden py-14">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            children
          )}
        </TableBody>
      </Table>
    </TableFrame>
  );
}
