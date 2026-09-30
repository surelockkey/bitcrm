"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus, Search, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DataScope, InventoryStatus } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { LocationStockDialog } from "@/features/inventory/stock/components/location-stock-dialog";
import { ContainerTemplateBar } from "@/features/inventory/templates/components/container-template-bar";
import { ApplyTemplateDialog } from "@/features/inventory/templates/components/apply-template-dialog";
import { useUrlPopups } from "@/features/inventory/use-url-popups";
import { useUserContainers, useUserNames } from "@/features/inventory/user-containers/hooks";
import {
  containerUserNames,
  unnamedUserIds,
  usersOfContainer,
} from "@/features/inventory/user-containers/lib";
import { useContainersList, useContainersCount } from "../hooks";
import type { ContainerFilter } from "../api";
import { ContainersTable } from "./containers-table";
import { ContainerCreateDialog } from "./container-create-dialog";
import { ContainerEditDialog } from "./container-edit-dialog";
import { MyContainerView } from "./my-container-view";
import { ListPagination } from "@/components/ui/list-pagination";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";

const CONTAINERS_PATH = "/inventory/containers";

/** The URL params that open a popup — one at a time; Apply also names the van. */
const POPUPS = ["stock", "edit", "apply"] as const;
const EXTRAS = ["container"] as const;

export function ContainersPage() {
  const { can, scopeOf } = usePermissions();

  if (!can("containers", "view")) {
    // Technicians hit "My Container"; anyone else without view is blocked.
    return <MyContainerView />;
  }
  // Assigned-only scope = a technician → their own van, not the fleet.
  if (scopeOf("containers") === DataScope.ASSIGNED_ONLY) {
    return <MyContainerView />;
  }
  return <Fleet />;
}

function Fleet() {
  const { can } = usePermissions();
  const [pageSize, setPageSize] = usePageSize("inventory-vans");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  // A van has no page of its own: its stock and its settings open over the
  // list, from the URL, so an old /inventory/containers/<id> link lands here.
  const popups = useUrlPopups(CONTAINERS_PATH, POPUPS, EXTRAS);
  const stockId = popups.param("stock");
  const editId = stockId ? null : popups.param("edit");
  const applyId = stockId || editId ? null : popups.param("apply");

  // The server filters before it cuts the page — filtering a page in the
  // browser is what made every page show a different number of vans.
  const term = useDebouncedValue(search.trim(), 300);
  const filter: ContainerFilter = useMemo(
    () => ({
      search: term || undefined,
      department: department === "all" ? undefined : department,
      status: status === "all" ? undefined : (status as InventoryStatus),
    }),
    [term, department, status],
  );

  const query = useContainersList(filter, pageSize);
  const count = useContainersCount(filter);
  const pager = usePager(pagedSource(query), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ filter, pageSize }),
  });
  const containers = pager.items;

  // Departments are free text on the van; the whole fleet names them, not one page.
  const locations = useAllLocations();
  const departments = useMemo(
    () =>
      [
        ...new Set(
          locations.data.map((l) => l.department).filter((d): d is string => !!d),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [locations.data],
  );

  const filtered = !!filter.search || !!filter.department || !!filter.status;

  // Who works from each van: every assignment in one request, named from the
  // directory where the backfill left only an id.
  const assignments = useUserContainers();
  const unnamed = useMemo(() => unnamedUserIds(assignments.data ?? []), [assignments.data]);
  const { names } = useUserNames(unnamed);
  const users = useMemo(() => {
    const rows = assignments.data ?? [];
    const byVan = containerUserNames(rows, names);
    const byUser = new Map(rows.map((r) => [r.userId, r] as const));
    return new Map(containers.map((c) => [c.id, usersOfContainer(c, byVan, byUser)] as const));
  }, [assignments.data, names, containers]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search containers"
            className="h-9 pl-8"
          />
        </div>
        {departments.length > 0 ? (
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="h-9 w-44" aria-label="Department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
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
        {/* Скільки всього — каже панель під таблицею; тут було б число однієї сторінки. */}
        <span className="ml-auto" />
        <Button asChild variant="outline" className="h-9 gap-1.5">
          <Link href="/technicians">
            Technicians
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
        {can("containers", "create") ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5 px-3.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
            New container
          </Button>
        ) : null}
      </div>

      <div className="flex-1 px-6 pb-6">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : containers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Truck className="size-6" />
            </div>
            <div>
              <div className="font-medium">{filtered ? "No containers match" : "No containers"}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {filtered
                  ? "Try clearing your search or filter."
                  : "A van appears here when a technician is activated."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <ContainersTable
              containers={containers}
              users={users}
              onEdit={(c) => popups.open("edit", c.id)}
              onStock={(c) => popups.open("stock", c.id)}
            />
            <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
          </>
        )}
      </div>

      <ContainerCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      {/* Mounted only while their param is set, so each opening reads fresh. */}
      {stockId ? (
        <LocationStockDialog
          type="container"
          locationId={stockId}
          open
          onOpenChange={(open) => (open ? undefined : popups.close())}
          aside={
            <ContainerTemplateBar
              containerId={stockId}
              // Swapped, not stacked: closing Apply goes back to the list.
              onApply={(templateId) => popups.replace("apply", templateId, { container: stockId })}
              onSetTemplate={() => popups.replace("edit", stockId)}
            />
          }
        />
      ) : null}
      {applyId ? (
        <ApplyTemplateDialog
          templateId={applyId}
          containerId={popups.param("container")}
          open
          onOpenChange={(open) => (open ? undefined : popups.close())}
          onContainerChange={(id) => popups.replace("apply", applyId, { container: id })}
        />
      ) : null}
      {editId ? (
        <ContainerEditDialog
          containerId={editId}
          open
          onOpenChange={(open) => (open ? undefined : popups.close())}
        />
      ) : null}
    </div>
  );
}
