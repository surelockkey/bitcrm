"use client";

import { useMemo, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { TableFrame } from "@/features/inventory/components/table-frame";
import { SkeletonRows } from "@/features/inventory/components/inventory-table";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";

/** One column: its id (the saved width's key), its header and the width it starts at. */
export interface ReportColumn {
  id: string;
  label: string;
  width: number;
}

/** Every row's height — real, skeleton and totals — so a page is as tall loading as loaded. */
export const REPORT_ROW = "h-11";

/**
 * The report's table: the inventory lists' frame (fixed columns the reader
 * can drag, a sideways scroll), with the Totals row where Workiz keeps it —
 * first, above the rows — in the header group, so it holds its place while
 * the rows page, load and reload under it.
 *
 * Loading, it is the same table: the same columns, the Totals row with bars
 * in its cells and a page of skeleton rows as tall as the real ones.
 */
export function ReportTable({
  tableKey,
  columns,
  loading,
  skeletonRows,
  stale = false,
  totals,
  totalsStale = false,
  status,
  children,
}: {
  /** Where the reader's column widths are saved. */
  tableKey: string;
  columns: ReportColumn[];
  loading: boolean;
  skeletonRows: number;
  /** The previous filter's rows, dimmed while the new ones load. */
  stale?: boolean;
  /** The Totals row's cells, one per column. */
  totals?: ReactNode[];
  /** The totals are the previous filter's, held while the new ones are counted. */
  totalsStale?: boolean;
  /** A single message across the body — nothing found, or a failed load. */
  status?: ReactNode;
  children?: ReactNode;
}) {
  const defaults = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, c.width])), [columns]);
  const { widthOf, setWidth, reset } = useColumnWidths(tableKey, defaults);

  return (
    <TableFrame>
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
          {totals ? (
            <TableRow
              className={cn(REPORT_ROW, "bg-muted font-semibold hover:bg-muted", totalsStale && "opacity-60 transition-opacity")}
            >
              {totals.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="truncate border-r border-table-border px-2 text-left align-middle">
                    {cell}
                  </th>
                ) : (
                  <TableCell key={i} className="truncate tabular-nums">
                    {cell}
                  </TableCell>
                ),
              )}
            </TableRow>
          ) : null}
        </TableHeader>
        <TableBody className={cn(stale && "opacity-60 transition-opacity")}>
          {loading ? (
            <SkeletonRows columns={columns.length} rows={skeletonRows} className={REPORT_ROW} />
          ) : status ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-24 text-left text-sm whitespace-normal text-muted-foreground">
                {status}
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
