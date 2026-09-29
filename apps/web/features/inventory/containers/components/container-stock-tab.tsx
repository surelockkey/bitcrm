"use client";

import { PackageX } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/features/inventory/warehouses/lib";
import { useContainerStockView } from "../hooks";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change. The last
 * one is dropped in read-only mode, from the colgroup as well as the header:
 * a colgroup one column longer than the row shifts every width sideways.
 */
const COLUMNS: { id: string; label: string; width: number; className?: string }[] = [
  { id: "product", label: "Product", width: 280 },
  { id: "category", label: "Category", width: 180 },
  { id: "onHand", label: "On hand", width: 120, className: "text-right" },
  { id: "unit", label: "Unit", width: 120, className: "text-right" },
  { id: "value", label: "Value", width: 130, className: "text-right" },
  { id: "actions", label: "Actions", width: 100, className: "text-right" },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

/** Its own key: a van's shelf is not the warehouse's, and not the items list. */
const TABLE_KEY = "inventory-container-stock";

export interface ContainerMoveTarget {
  productId: string;
  productName: string;
  onHand: number;
}

export function ContainerStockTab({
  containerId,
  readOnly,
  onMove,
}: {
  containerId: string;
  readOnly?: boolean;
  onMove?: (item: ContainerMoveTarget) => void;
}) {
  const { rows, summary, isLoading, isError } = useContainerStockView(containerId);
  const { widthOf, setWidth, reset } = useColumnWidths(TABLE_KEY, DEFAULT_WIDTHS);
  const columns = COLUMNS.filter((c) => c.id !== "actions" || !readOnly);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (isError) return <Empty title="Couldn't load stock" body="Try again shortly." />;
  if (rows.length === 0) {
    return <Empty title="Empty van" body="No stock on this truck. Restock it with a transfer from a warehouse." />;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="SKUs" value={summary.skuCount.toLocaleString()} />
        <Stat label="On hand" value={summary.totalUnits.toLocaleString()} />
        <Stat label="Value" value={formatMoney(summary.totalValue)} accent />
        <Stat label="Low stock" value={String(summary.lowCount)} warn={summary.lowCount > 0} />
      </div>

      <div className="overflow-hidden border">
        {/* `table-fixed`: the column decides its width, not the longest
            product name on the truck — and the reader can drag the edge. */}
        <Table className="table-fixed">
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
                  className={c.className}
                >
                  {/* The move column carries no visible heading, but the
                      handle still needs something to be named after. */}
                  {c.id === "actions" ? <span className="sr-only">Actions</span> : undefined}
                </ResizableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.productId} className="hover:bg-muted/40">
                {/* Every cell clips: under fixed layout one that doesn't
                    spills over the next column instead of widening its own. */}
                <TableCell className="overflow-hidden">
                  <div className="truncate font-medium">{r.name}</div>
                  {r.sku ? <div className="truncate font-mono text-[11px] text-muted-foreground">{r.sku}</div> : null}
                </TableCell>
                <TableCell className="truncate text-sm text-muted-foreground">{r.category ?? "—"}</TableCell>
                <TableCell className="overflow-hidden text-right">
                  {r.isLow ? (
                    <Badge variant="outline" className="gap-1 border-amber-500/30 font-normal tabular-nums text-amber-600 dark:text-amber-500">
                      {r.quantity} · low
                    </Badge>
                  ) : (
                    <span className="tabular-nums">{r.quantity}</span>
                  )}
                </TableCell>
                <TableCell className="truncate text-right tabular-nums text-muted-foreground">
                  {r.unitPrice != null ? formatMoney(r.unitPrice) : "—"}
                </TableCell>
                <TableCell className="truncate text-right font-medium tabular-nums">
                  {r.value != null ? formatMoney(r.value) : "—"}
                </TableCell>
                {!readOnly ? (
                  <TableCell className="overflow-hidden text-right">
                    {onMove ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => onMove({ productId: r.productId, productName: r.name, onHand: r.quantity })}
                      >
                        Move ↗
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="truncate">{summary.skuCount} SKUs</TableCell>
              <TableCell />
              <TableCell className="truncate text-right tabular-nums">{summary.totalUnits.toLocaleString()}</TableCell>
              <TableCell />
              <TableCell className="truncate text-right tabular-nums">{formatMoney(summary.totalValue)}</TableCell>
              {!readOnly ? <TableCell /> : null}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3.5">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={"mt-0.5 text-xl font-semibold tabular-nums " + (warn ? "text-amber-600 dark:text-amber-500" : accent ? "text-brand" : "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <PackageX className="size-6" />
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
