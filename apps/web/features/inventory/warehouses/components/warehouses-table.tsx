"use client";

import { useMemo, type ReactNode } from "react";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { LocationActions, LocationName } from "@/features/inventory/components/locations-grid";
import { formatTotal, type LocationTotals } from "@/features/inventory/stock/lib";

/**
 * Workiz's Locations grid for warehouses (pg_inventory_wz_02_locations):
 * Name 200 · Description · Items · (BitCRM's SKUs) · Actions 150 — Workiz's
 * flexible columns share what is left alike.
 */
export const WAREHOUSE_COLUMNS: { id: string; label: string; width?: number }[] = [
  { id: "name", label: "Name", width: 200 },
  { id: "description", label: "Description" },
  { id: "items", label: "Items" },
  { id: "skus", label: "SKUs" },
  { id: "actions", label: "Actions", width: 150 },
];

/** Its own key: warehouses keep their page size and widths apart from vans and items. */
export const WAREHOUSES_TABLE_KEY = "inventory-warehouses";

/** react-table's flexible column, when the reader drags one: its share of a 1400px frame. */
const FLEX = 350;
const WIDTHS = Object.fromEntries(WAREHOUSE_COLUMNS.map((c) => [c.id, c.width ?? FLEX]));
const NO_ROWS: Warehouse[] = [];

export function WarehousesTable({
  warehouses,
  onEdit,
  onStock,
  loading = false,
  stale = false,
  footer,
}: {
  warehouses: Warehouse[];
  onEdit: (warehouse: Warehouse) => void;
  onStock: (warehouse: Warehouse) => void;
  /** First load: the header and Workiz's loader. */
  loading?: boolean;
  /** The previous filter's rows, dimmed, while the new ones load. */
  stale?: boolean;
  footer?: ReactNode;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths(`${WAREHOUSES_TABLE_KEY}-wz`, WIDTHS);
  const columns = useMemo<WzReportColumn<Warehouse & LocationTotals>[]>(() => {
    const cell: Record<string, (w: Warehouse & LocationTotals) => ReactNode> = {
      name: (w) => <LocationName name={w.name} archived={w.status === InventoryStatus.ARCHIVED} />,
      description: (w) => (
        <span className="block truncate" title={w.description || w.address || undefined}>
          {w.description || w.address || ""}
        </span>
      ),
      // The server keeps both on the row; there is nothing to wait for.
      items: (w) => formatTotal(w.totalUnits),
      skus: (w) => formatTotal(w.uniqueItems),
      actions: (w) => <LocationActions name={w.name} onEdit={() => onEdit(w)} onStock={() => onStock(w)} />,
    };
    return WAREHOUSE_COLUMNS.map((c) => ({ id: c.id, label: c.label, cell: cell[c.id] }));
  }, [onEdit, onStock]);

  return (
    <WzReportGrid
      aria-label="Warehouses"
      className="shrink-0"
      columns={columns}
      rows={loading ? NO_ROWS : warehouses}
      rowKey={(w) => w.id}
      sort={null}
      resize={{ widthOf, setWidth, reset }}
      // A row opens its stock, as the box does.
      onRowClick={(w) => onStock(w)}
      loading={loading}
      busy={stale}
      plainFiller
      // Workiz's Locations: an empty search leaves the blank rows, nothing written over them.
      emptyText={null}
      footer={footer}
    />
  );
}
