"use client";

import { useMemo, useState } from "react";
import { Search, TriangleAlert, Warehouse as WarehouseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InventoryStatus } from "@bitcrm/types";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/inventory/components/no-access";
import { ListBody } from "@/features/inventory/components/list-body";
import { useSkeletonRows } from "@/features/inventory/components/use-skeleton-rows";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { ListPagination } from "@/components/ui/list-pagination";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { LocationStockDialog } from "@/features/inventory/stock/components/location-stock-dialog";
import { usePopup } from "@/features/inventory/use-popup";
import { useWarehousesList, useWarehousesCount } from "../hooks";
import type { WarehouseFilter } from "../api";
import { WarehousesTable } from "./warehouses-table";
import { WarehouseCreateDialog } from "./warehouse-create-dialog";
import { WarehouseEditDialog } from "./warehouse-edit-dialog";

/** The popup over the list — one at a time: a warehouse's stock or its settings. */
type WarehousesPopup = { kind: "stock"; id: string } | { kind: "edit"; id: string };

/** Old links carried the popup in the query; they land on the plain list, the params dropped. */
const STALE_PARAMS = ["stock", "edit"] as const;

/** The list's own key: its page size and its skeleton's height are saved under it. */
const TABLE_KEY = "inventory-warehouses";

export function WarehousesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const [pageSize, setPageSize] = usePageSize(TABLE_KEY);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(InventoryStatus.ACTIVE);
  const [createOpen, setCreateOpen] = useState(false);

  // A warehouse has no page of its own: its stock and its settings open over
  // the list as state; an old /inventory/warehouses/<id> link lands on the list.
  const { popup, open, close } = usePopup<WarehousesPopup>(STALE_PARAMS);
  const stockId = popup?.kind === "stock" ? popup.id : null;
  const editId = popup?.kind === "edit" ? popup.id : null;

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
  const pager = usePager(pagedSource(query), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ filter, pageSize }),
  });
  const warehouses = pager.items;
  const filtered = !!filter.search || status !== InventoryStatus.ACTIVE;
  // Nothing on screen yet: the table draws itself, a page of skeleton rows tall.
  const loading = query.isLoading && !query.data;
  const failed = query.isError && !query.data;
  const empty = !failed && !loading && warehouses.length === 0;
  const skeletonRows = useSkeletonRows(
    TABLE_KEY,
    pageSize,
    count.data?.total,
    loading || pager.isStale ? undefined : warehouses.length,
  );

  // Refused only once the permissions are known — never a flash of "No access".
  if (denied("warehouses", "view")) {
    return <NoAccess text="You don't have permission to view warehouses." />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search warehouses"
            className="h-9 pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-32" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value={InventoryStatus.ACTIVE}>Active</SelectItem>
            <SelectItem value={InventoryStatus.ARCHIVED}>Archived</SelectItem>
          </SelectContent>
        </Select>
        {/* Скільки всього — каже панель під таблицею. */}
        <span className="ml-auto" />
        {/* In place from the first frame, off until the permissions answer:
            appearing late, it pushed the toolbar about. */}
        {permsLoading || can("warehouses", "create") ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5 px-3.5"
            disabled={permsLoading}
            onClick={() => setCreateOpen(true)}
          >
            <WarehouseIcon className="size-4" />
            New warehouse
          </Button>
        ) : null}
      </div>

      <div className="flex-1 px-6 pb-6">
        <ListBody
          holdKey={JSON.stringify(filter)}
          scrollKey={`${pager.page}:${pageSize}`}
          pager={
            failed || empty ? null : (
              <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} reserveSpace />
            )
          }
        >
          {failed ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <TriangleAlert className="size-6" />
              </div>
              <div className="font-medium">Couldn&apos;t load warehouses</div>
              <Button variant="outline" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <WarehouseIcon className="size-6" />
              </div>
              <div>
                <div className="font-medium">
                  {filtered ? "No warehouses match" : "No warehouses yet"}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {filtered
                    ? "Try clearing your search or filter."
                    : "Create your first warehouse to start receiving stock."}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Loading, loaded or holding the last filter's rows — one table,
                  so nothing under it moves when the rows land. */}
              <WarehousesTable
                warehouses={warehouses}
                loading={loading}
                skeletonRows={skeletonRows}
                stale={pager.isStale}
                onEdit={(w) => open({ kind: "edit", id: w.id })}
                onStock={(w) => open({ kind: "stock", id: w.id })}
              />
            </>
          )}
        </ListBody>
      </div>

      <WarehouseCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      {/* Mounted only while open, so each opening reads fresh. */}
      {stockId ? (
        <LocationStockDialog
          type="warehouse"
          locationId={stockId}
          open
          onOpenChange={(next) => (next ? undefined : close())}
        />
      ) : null}
      {editId ? (
        <WarehouseEditDialog
          warehouseId={editId}
          open
          onOpenChange={(next) => (next ? undefined : close())}
        />
      ) : null}
    </div>
  );
}
