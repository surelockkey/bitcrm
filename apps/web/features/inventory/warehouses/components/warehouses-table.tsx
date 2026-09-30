"use client";

import { Boxes, Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { useWarehouseStockView } from "../hooks";
import { TableFrame } from "@/features/inventory/components/table-frame";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change. All
 * left-aligned, counts included, as Workiz lays its grids out.
 */
const COLUMNS: { id: string; label: string; width: number }[] = [
  { id: "name", label: "Name", width: 260 },
  { id: "description", label: "Description", width: 340 },
  { id: "items", label: "Items", width: 120 },
  { id: "actions", label: "Actions", width: 100 },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

/** Its own key: warehouses keep their widths apart from vans and items. */
const TABLE_KEY = "inventory-warehouses";

export function WarehousesTable({
  warehouses,
  onEdit,
  onStock,
}: {
  warehouses: Warehouse[];
  onEdit: (warehouse: Warehouse) => void;
  onStock: (warehouse: Warehouse) => void;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths(TABLE_KEY, DEFAULT_WIDTHS);

  return (
    <TableFrame>
      {/* `table-fixed`: the column decides its width, not the longest
          description in the list — and the reader can drag the edge. */}
      <Table className="table-fixed">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
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
        <TableBody>
          {warehouses.map((w) => (
            <WarehouseRow key={w.id} warehouse={w} onEdit={onEdit} onStock={onStock} />
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

function WarehouseRow({
  warehouse: w,
  onEdit,
  onStock,
}: {
  warehouse: Warehouse;
  onEdit: (warehouse: Warehouse) => void;
  onStock: (warehouse: Warehouse) => void;
}) {
  // One stock read per row shown — the list carries no totals.
  const { summary, isLoading } = useWarehouseStockView(w.id);
  const archived = w.status === InventoryStatus.ARCHIVED;
  const description = w.description || w.address;

  return (
    <TableRow className={cn("cursor-pointer", archived && "opacity-55")} onClick={() => onStock(w)}>
      {/* Every cell clips: under fixed layout one that doesn't spills over
          the next column instead of widening its own. */}
      <TableCell className="overflow-hidden">
        <div className="truncate font-medium">{w.name}</div>
        {!isLoading && summary.lowCount > 0 ? (
          <Badge
            variant="outline"
            className="mt-1 gap-1 border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
          >
            Low stock
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="truncate text-sm text-muted-foreground" title={description || undefined}>
        {description || "—"}
      </TableCell>
      <TableCell className="truncate tabular-nums">
        {isLoading ? <Skeleton className="h-4 w-12" /> : summary.totalUnits.toLocaleString()}
      </TableCell>
      {/* The popups these open sit over the row; their clicks must not reach it. */}
      <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          <RowIconAction label={`Edit ${w.name}`} tip="Edit" onClick={() => onEdit(w)}>
            <Pencil />
          </RowIconAction>
          <RowIconAction label={`Stock in ${w.name}`} tip="Stock" onClick={() => onStock(w)}>
            <Boxes />
          </RowIconAction>
        </div>
      </TableCell>
    </TableRow>
  );
}
