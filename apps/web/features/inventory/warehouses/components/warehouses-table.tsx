"use client";

import { Boxes, Pencil } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import {
  INVENTORY_ROW,
  InventoryTable,
  type InventoryColumn,
} from "@/features/inventory/components/inventory-table";
import { formatTotal, type LocationTotals } from "@/features/inventory/stock/lib";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change. All
 * left-aligned, counts included, as Workiz lays its grids out.
 */
const COLUMNS: InventoryColumn[] = [
  { id: "name", label: "Name", width: 260 },
  { id: "description", label: "Description", width: 340 },
  { id: "items", label: "Items", width: 120 },
  { id: "skus", label: "SKUs", width: 90 },
  { id: "actions", label: "Actions", width: 100 },
];

/** Its own key: warehouses keep their widths apart from vans and items. */
const TABLE_KEY = "inventory-warehouses";

export function WarehousesTable({
  warehouses,
  onEdit,
  onStock,
  loading = false,
  skeletonRows = 0,
  stale = false,
}: {
  warehouses: Warehouse[];
  onEdit: (warehouse: Warehouse) => void;
  onStock: (warehouse: Warehouse) => void;
  /** First load: the same table, a page of skeleton rows. */
  loading?: boolean;
  skeletonRows?: number;
  /** The previous filter's rows, held while the new ones load. */
  stale?: boolean;
}) {
  return (
    <InventoryTable
      tableKey={TABLE_KEY}
      columns={COLUMNS}
      loading={loading}
      skeletonRows={skeletonRows}
      stale={stale}
    >
      {warehouses.map((w) => (
        <WarehouseRow key={w.id} warehouse={w} onEdit={onEdit} onStock={onStock} />
      ))}
    </InventoryTable>
  );
}

function WarehouseRow({
  warehouse: w,
  onEdit,
  onStock,
}: {
  warehouse: Warehouse & LocationTotals;
  onEdit: (warehouse: Warehouse) => void;
  onStock: (warehouse: Warehouse) => void;
}) {
  const archived = w.status === InventoryStatus.ARCHIVED;
  const description = w.description || w.address;

  return (
    <TableRow className={cn(INVENTORY_ROW, "cursor-pointer", archived && "opacity-55")} onClick={() => onStock(w)}>
      {/* Every cell clips: under fixed layout one that doesn't spills over
          the next column instead of widening its own. */}
      <TableCell className="truncate font-medium">{w.name}</TableCell>
      <TableCell className="truncate text-sm text-muted-foreground" title={description || undefined}>
        {description || "—"}
      </TableCell>
      {/* The server keeps both on the row; there is nothing to wait for. */}
      <TableCell className="truncate tabular-nums">{formatTotal(w.totalUnits)}</TableCell>
      <TableCell className="truncate tabular-nums">{formatTotal(w.uniqueItems)}</TableCell>
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
