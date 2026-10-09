"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { ListPagination } from "@/components/ui/list-pagination";
import { WzReportGrid } from "@/components/workiz/report-grid";
import { WzListToolbar } from "@/components/workiz/toolbar";
import { arraySource } from "@/lib/paging/array-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { ITEM_BASE_COLUMNS } from "@/features/inventory/products/components/products-table";
import {
  WAREHOUSE_COLUMNS,
  WAREHOUSES_TABLE_KEY,
} from "@/features/inventory/warehouses/components/warehouses-table";
import {
  CONTAINER_COLUMNS,
  CONTAINERS_TABLE_KEY,
} from "@/features/inventory/containers/components/containers-table";
import {
  USER_CONTAINER_COLUMNS,
  USER_CONTAINERS_TABLE_KEY,
} from "@/features/inventory/user-containers/components/user-containers-table";
import { TEMPLATE_COLUMNS, TEMPLATES_TABLE_KEY } from "@/features/inventory/templates/components/templates-table";
import { TRANSFER_COLUMNS, TRANSFERS_TABLE_KEY } from "@/features/inventory/transfers/components/transfers-table";
import { InventoryTable, type InventoryColumn } from "./inventory-table";
import { useSkeletonRows } from "./use-skeleton-rows";

export type InventoryTab = "items" | "warehouses" | "containers" | "user-containers" | "templates" | "transfers";

/**
 * The Workiz tabs' first frame: the band over the strip (its height), the
 * strip, and the grid's header over Workiz's loader — what the page draws
 * while it waits, so it lands on the same boxes.
 */
const WZ_FRAMES: Partial<Record<InventoryTab, { band: string; headers: string[] }>> = {
  // 20px + the 48.64px boxes + 20px.
  items: { band: "h-[88.64px]", headers: ITEM_BASE_COLUMNS.map((c) => c.label).concat("Actions") },
  // Workiz's Locations band: Add New 16px under the rule, 73px to the strip.
  warehouses: { band: "h-[73px]", headers: WAREHOUSE_COLUMNS.map((c) => c.label) },
  containers: { band: "h-[73px]", headers: CONTAINER_COLUMNS.map((c) => c.label) },
};

const TABLES: Record<InventoryTab, { key: string; columns: InventoryColumn[]; rowClassName?: string }> = {
  items: { key: "inventory-items", columns: [] },
  warehouses: { key: WAREHOUSES_TABLE_KEY, columns: [] },
  containers: { key: CONTAINERS_TABLE_KEY, columns: [] },
  "user-containers": { key: USER_CONTAINERS_TABLE_KEY, columns: USER_CONTAINER_COLUMNS, rowClassName: "h-[3.25rem]" },
  templates: { key: TEMPLATES_TABLE_KEY, columns: TEMPLATE_COLUMNS },
  transfers: { key: TRANSFERS_TABLE_KEY, columns: TRANSFER_COLUMNS },
};

/**
 * An Inventory tab before its page has rendered — the Suspense fallback of
 * each tab's route: the tab's own frame, its grid's header over the loader;
 * the page then draws over it at the same size.
 */
export function TabFallback({ tab }: { tab: InventoryTab }) {
  const wz = WZ_FRAMES[tab];
  if (wz) return <WzTabFallback band={wz.band} headers={wz.headers} />;
  return <TableTabFallback tab={tab} />;
}

function WzTabFallback({ band, headers }: { band: string; headers: string[] }) {
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
      />
    </div>
  );
}

function TableTabFallback({ tab }: { tab: InventoryTab }) {
  const { key, columns, rowClassName } = TABLES[tab];
  const [pageSize, setPageSize] = usePageSize(key);
  const rows = useSkeletonRows(key, pageSize, undefined, undefined);
  const pager = usePager(arraySource<never>([], pageSize, true), {});

  return (
    <div className="flex flex-1 flex-col" aria-busy="true">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-9 w-32" />
        <span className="ml-auto" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="flex-1 px-6 pb-6">
        <InventoryTable tableKey={key} columns={columns} loading skeletonRows={rows} rowClassName={rowClassName} />
        <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} reserveSpace />
      </div>
    </div>
  );
}
