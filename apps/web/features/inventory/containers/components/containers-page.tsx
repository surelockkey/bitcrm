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
import { DataScope, InventoryStatus } from "@bitcrm/types";
import { useSearchParams } from "next/navigation";
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
import { useContainersList, useContainersCount, usePrefetchVanStock } from "../hooks";
import type { ContainerFilter } from "../api";
import { ContainersTable } from "./containers-table";
import { ContainerCreateDialog } from "./container-create-dialog";
import { ContainerEditDialog } from "./container-edit-dialog";
import { MyContainerView } from "./my-container-view";
import { ListPagination } from "@/components/ui/list-pagination";
import { arraySource } from "@/lib/paging/array-source";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useSkeletonRows } from "@/features/inventory/components/use-skeleton-rows";

const CONTAINERS_PATH = "/inventory/containers";

/** The list's own key: its page size and its skeleton's height are saved under it. */
const TABLE_KEY = "inventory-vans";

/** The URL params that open a popup — one at a time; Apply also names the van. */
const POPUPS = ["stock", "edit", "apply"] as const;
const EXTRAS = ["container"] as const;

export function ContainersPage() {
  const { can, scopeOf, isLoading } = usePermissions();
  // A van's stock popup opened by link needs no permission to be asked for
  // (the server guards it): its reads start now, beside the permissions',
  // instead of after them and the page.
  const linked = useSearchParams().get("stock");
  usePrefetchVanStock(isLoading ? linked : null);

  // Which screen this is — the fleet or a technician's own van — is the
  // permissions' to say. Until they do: the fleet's frame, asking for
  // nothing. Guessing "My Container" flashed its skeleton on every
  // dispatcher's refresh and fired two requests that 404 for office users.
  if (isLoading) return <FleetFrame />;

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
  const [pageSize, setPageSize] = usePageSize(TABLE_KEY);
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
  // Nothing on screen yet: the table draws itself, a page of skeleton rows tall.
  const loading = query.isLoading && !query.data;
  const skeletonRows = useSkeletonRows(
    TABLE_KEY,
    pageSize,
    count.data?.total,
    loading || pager.isStale ? undefined : containers.length,
  );

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
      <FleetToolbar
        search={search}
        onSearch={setSearch}
        department={department}
        onDepartment={setDepartment}
        departments={departments}
        departmentsLoading={locations.isLoading}
        status={status}
        onStatus={setStatus}
        canCreate={can("containers", "create")}
        onCreate={() => setCreateOpen(true)}
      />

      <div className="flex-1 px-6 pb-6">
        {!loading && containers.length === 0 ? (
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
            {/* Loading, loaded or holding the last filter's rows — one table,
                so nothing under it moves when the rows land. */}
            <ContainersTable
              containers={containers}
              users={users}
              loading={loading}
              skeletonRows={skeletonRows}
              stale={pager.isStale}
              onEdit={(c) => popups.open("edit", c.id)}
              onStock={(c) => popups.open("stock", c.id)}
            />
            <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} reserveSpace />
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

/**
 * The fleet's toolbar. Every control is there from the first frame: the
 * Department select waits (disabled) for the departments instead of popping
 * in and pushing Status and the buttons sideways.
 */
function FleetToolbar({
  search,
  onSearch,
  department,
  onDepartment,
  departments,
  departmentsLoading,
  status,
  onStatus,
  canCreate,
  onCreate,
  pending = false,
}: {
  search: string;
  onSearch: (term: string) => void;
  department: string;
  onDepartment: (department: string) => void;
  departments: string[];
  departmentsLoading: boolean;
  status: string;
  onStatus: (status: string) => void;
  canCreate: boolean;
  onCreate: () => void;
  /** Permissions still loading: everything in place, nothing to press yet. */
  pending?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-3">
      <div className="relative w-full max-w-xs">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search containers"
          className="h-9 pl-8"
          disabled={pending}
        />
      </div>
      <Select value={department} onValueChange={onDepartment} disabled={pending || departmentsLoading}>
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
      <Select value={status} onValueChange={onStatus} disabled={pending}>
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
      {pending || canCreate ? (
        <Button variant="brand" className="h-9 gap-1.5 px-3.5" disabled={pending} onClick={onCreate}>
          <Plus className="size-4" />
          New container
        </Button>
      ) : null}
    </div>
  );
}

const noop = () => {};

/**
 * The fleet as it will look, before anything is known: the toolbar and a
 * page of skeleton rows. It reads nothing — not the list, not "my van".
 */
function FleetFrame() {
  const [pageSize, setPageSize] = usePageSize(TABLE_KEY);
  const skeletonRows = useSkeletonRows(TABLE_KEY, pageSize, undefined, undefined);
  const pager = usePager(arraySource<never>([], pageSize, true), {});
  return (
    <div className="flex flex-1 flex-col">
      <FleetToolbar
        search=""
        onSearch={noop}
        department="all"
        onDepartment={noop}
        departments={[]}
        departmentsLoading
        status="all"
        onStatus={noop}
        canCreate={false}
        onCreate={noop}
        pending
      />
      <div className="flex-1 px-6 pb-6">
        <ContainersTable
          containers={[]}
          users={new Map()}
          loading
          skeletonRows={skeletonRows}
          onEdit={noop}
          onStock={noop}
        />
        <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} reserveSpace />
      </div>
    </div>
  );
}
