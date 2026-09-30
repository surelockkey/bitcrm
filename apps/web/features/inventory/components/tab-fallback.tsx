"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { ListPagination } from "@/components/ui/list-pagination";
import { arraySource } from "@/lib/paging/array-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { PRODUCT_COLUMNS, PRODUCTS_TABLE_KEY } from "@/features/inventory/products/components/products-table";
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

const TABLES: Record<InventoryTab, { key: string; columns: InventoryColumn[]; rowClassName?: string }> = {
  items: { key: PRODUCTS_TABLE_KEY, columns: PRODUCT_COLUMNS },
  warehouses: { key: WAREHOUSES_TABLE_KEY, columns: WAREHOUSE_COLUMNS },
  containers: { key: CONTAINERS_TABLE_KEY, columns: CONTAINER_COLUMNS },
  "user-containers": { key: USER_CONTAINERS_TABLE_KEY, columns: USER_CONTAINER_COLUMNS, rowClassName: "h-[3.25rem]" },
  templates: { key: TEMPLATES_TABLE_KEY, columns: TEMPLATE_COLUMNS },
  transfers: { key: TRANSFERS_TABLE_KEY, columns: TRANSFER_COLUMNS },
};

/**
 * An Inventory tab before its page has rendered — the Suspense fallback of
 * each tab's route (and of a link's page, `/inventory/items/<id>`): the
 * toolbar's place, the tab's own table over a page of placeholder rows, and
 * the pager's place; the page then draws over it at the same size.
 */
export function TabFallback({ tab }: { tab: InventoryTab }) {
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
