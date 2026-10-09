"use client";

import { useCallback, useMemo, useState } from "react";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WZ_GRID_PAGE_SIZES } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/inventory/components/no-access";
import { useInventoryPageReady } from "@/features/inventory/components/inventory-frame";
import { LocationsBand } from "@/features/inventory/components/locations-grid";
import { LocationStockDialog } from "@/features/inventory/stock/components/location-stock-dialog";
import { usePopup } from "@/features/inventory/use-popup";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled } from "@/lib/use-page-ready";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useWarehousesList, useWarehousesCount } from "../hooks";
import type { WarehouseFilter } from "../api";
import { WAREHOUSES_TABLE_KEY, WarehousesTable } from "./warehouses-table";
import { WarehouseCreateDialog } from "./warehouse-create-dialog";
import { WarehouseEditDialog } from "./warehouse-edit-dialog";

/** The popup over the list — one at a time: a warehouse's stock or its settings. */
type WarehousesPopup = { kind: "stock"; id: string } | { kind: "edit"; id: string };

/** Old links carried the popup in the query; they land on the plain list, the params dropped. */
const STALE_PARAMS = ["stock", "edit"] as const;

/**
 * Warehouses — Workiz's Locations tab (pg_inventory_wz_02_locations) for the
 * fixed locations, the owner's split from the vans: Add New in the band;
 * the strip with Search (and BitCRM's status box) and the page size; the
 * grid Name · Description · Items · SKUs · Actions with the pager in it.
 * The pencil opens Workiz's Edit Location, the box (or the row) the
 * warehouse's Manage stock — popups over the list.
 */
export function WarehousesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const [pageSize, setPageSize] = usePageSize(WAREHOUSES_TABLE_KEY, { sizes: WZ_GRID_PAGE_SIZES, fallback: 10 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(InventoryStatus.ACTIVE);
  const [createOpen, setCreateOpen] = useState(false);

  // A warehouse has no page of its own: its stock and its settings open over
  // the list as state; an old /inventory/warehouses/<id> link lands on the list.
  const { popup, open, close } = usePopup<WarehousesPopup>(STALE_PARAMS);
  const stockId = popup?.kind === "stock" ? popup.id : null;
  const editId = popup?.kind === "edit" ? popup.id : null;
  const onEdit = useCallback((w: Warehouse) => open({ kind: "edit", id: w.id }), [open]);
  const onStock = useCallback((w: Warehouse) => open({ kind: "stock", id: w.id }), [open]);

  // The server searches and filters; the browser shows the page it got.
  const term = useDebouncedValue(search.trim(), 300);
  const filter: WarehouseFilter = useMemo(
    () => ({
      ...(term ? { search: term } : {}),
      ...(status === "all" ? {} : { status: status as InventoryStatus }),
    }),
    [term, status],
  );

  const query = useWarehousesList(filter, pageSize);
  const count = useWarehousesCount(filter);
  const src = pagedSource(query);
  const pager = usePager(query.isPlaceholderData ? { ...src, hasNextPage: false } : src, {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ filter, pageSize }),
  });
  const warehouses = pager.items;
  // One loader, then the list whole — the rows wait for the count, whose
  // "of N" came a beat after them. Latched: a new filter keeps the rows on
  // screen, dimmed.
  const ready = useInventoryPageReady(settled(query) && settled(count));
  const failed = query.isError && !query.data;

  // Refused only once the permissions are known — never a flash of "No access".
  if (denied("warehouses", "view")) {
    return <NoAccess text="You don't have permission to view warehouses." />;
  }

  return (
    <div className="flex flex-col">
      <LocationsBand
        canAdd={permsLoading || can("warehouses", "create")}
        pending={permsLoading}
        onAdd={() => setCreateOpen(true)}
      />

      <WzListToolbar data-testid="warehouses-toolbar" className="shrink-0">
        <WzSearchBox value={search} onChange={setSearch} />
        {/* BitCRM's own box: archived warehouses stay findable (Workiz deletes them). */}
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-10 w-[200px]" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={InventoryStatus.ACTIVE}>Active</SelectItem>
            <SelectItem value={InventoryStatus.ARCHIVED}>Archived</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
        <WzPageSizeSelect className="ml-auto" value={pageSize} sizes={WZ_GRID_PAGE_SIZES} onChange={setPageSize} />
      </WzListToolbar>

      {failed ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p role="alert">Couldn&apos;t load warehouses</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <WarehousesTable
          warehouses={warehouses}
          loading={!ready}
          stale={query.isPlaceholderData}
          onEdit={onEdit}
          onStock={onStock}
          // Drawn with the rows, its total and all — never under the loader.
          footer={ready ? <WzPager pager={pager} plainNumbers /> : null}
        />
      )}

      <WarehouseCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      {/* Mounted only while open, so each opening reads fresh. */}
      {stockId ? (
        <LocationStockDialog type="warehouse" locationId={stockId} open onOpenChange={(next) => (next ? undefined : close())} />
      ) : null}
      {editId ? (
        <WarehouseEditDialog warehouseId={editId} open onOpenChange={(next) => (next ? undefined : close())} />
      ) : null}
    </div>
  );
}
