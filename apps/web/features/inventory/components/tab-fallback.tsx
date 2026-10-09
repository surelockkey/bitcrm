"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { WzReportGrid } from "@/components/workiz/report-grid";
import { WzListToolbar } from "@/components/workiz/toolbar";
import { ITEM_BASE_COLUMNS } from "@/features/inventory/products/components/products-table";
import { WAREHOUSE_COLUMNS } from "@/features/inventory/warehouses/components/warehouses-table";
import { CONTAINER_COLUMNS } from "@/features/inventory/containers/components/containers-table";
import { USER_CONTAINER_COLUMNS } from "@/features/inventory/user-containers/components/user-containers-table";
import { TEMPLATE_COLUMNS } from "@/features/inventory/templates/components/templates-table";
import { TRANSFER_COLUMNS } from "@/features/inventory/transfers/components/transfers-table";
import { INVENTORY_ROW_HEIGHTS } from "@/features/inventory/row-heights";

export type InventoryTab = "items" | "warehouses" | "containers" | "user-containers" | "templates" | "transfers";

/** Workiz's Locations band: Add New 16px under the tab rule, 73px down to the strip. */
const LOCATIONS_BAND = "h-[73px]";

/**
 * Each tab's first frame: the band over the strip (its height), the strip,
 * and the grid's header over Workiz's loader — what the page draws while it
 * waits, so it lands on the same boxes.
 */
const FRAMES: Record<InventoryTab, { band: string; headers: string[] }> = {
  // 20px + the 48.64px boxes + 20px.
  items: { band: "h-[88.64px]", headers: ITEM_BASE_COLUMNS.map((c) => c.label).concat("Actions") },
  warehouses: { band: LOCATIONS_BAND, headers: WAREHOUSE_COLUMNS.map((c) => c.label) },
  containers: { band: LOCATIONS_BAND, headers: CONTAINER_COLUMNS.map((c) => c.label) },
  // Workiz's User locations: the strip right under the tab rule.
  "user-containers": { band: "h-0", headers: USER_CONTAINER_COLUMNS.map((c) => c.label) },
  templates: { band: LOCATIONS_BAND, headers: TEMPLATE_COLUMNS.map((c) => c.label) },
  transfers: { band: LOCATIONS_BAND, headers: TRANSFER_COLUMNS.map((c) => c.label) },
};

/**
 * An Inventory tab before its page has rendered — the Suspense fallback of
 * each tab's route: the tab's own frame, its grid's header over the loader;
 * the page then draws over it at the same size.
 */
export function TabFallback({ tab }: { tab: InventoryTab }) {
  const { band, headers } = FRAMES[tab];
  return (
    <div className="flex flex-col" aria-busy="true">
      <div className={band} />
      <WzListToolbar>
        <Skeleton className="h-10 w-[348px] max-w-full" />
      </WzListToolbar>
      <WzReportGrid
        columns={headers.map((label) => ({ id: label, label, cell: () => null }))}
        rows={[]}
        rowKey={() => ""}
        loading
        stickyHeader={false}
        rowHeight={INVENTORY_ROW_HEIGHTS[tab]}
      />
    </div>
  );
}
