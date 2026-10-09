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
import { usePermissions } from "@/features/auth/use-permissions";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled } from "@/lib/use-page-ready";
import { useInventoryPageReady } from "@/features/inventory/components/inventory-frame";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { LocationStockDialog } from "@/features/inventory/stock/components/location-stock-dialog";
import { ContainerTemplateBar } from "@/features/inventory/templates/components/container-template-bar";
import { ApplyTemplateDialog } from "@/features/inventory/templates/components/apply-template-dialog";
import { useDropStaleParams, usePopup } from "@/features/inventory/use-popup";
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
import { useSkeletonRows } from "@/features/inventory/components/use-skeleton-rows";
import { ListBody } from "@/features/inventory/components/list-body";

/** The list's own key: its page size and its skeleton's height are saved under it. */
const TABLE_KEY = "inventory-vans";

/**
 * The popup over the fleet — one at a time: a van's stock, its settings, or a
 * template applied to it.
 */
type ContainersPopup =
  | { kind: "stock"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "apply"; templateId: string; containerId: string | null };

/** Old links carried the popup in the query; they land on the plain list, the params dropped. */
const STALE_PARAMS = ["stock", "edit", "apply", "container"] as const;

export function ContainersPage() {
  const { can, scopeOf, isLoading } = usePermissions();
  // An old ?stock= / ?edit= link lands on the plain page — whichever it turns out to be.
  useDropStaleParams(STALE_PARAMS);

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
  // list as state; an old /inventory/containers/<id> link lands on the list.
  const { popup, open, close } = usePopup<ContainersPopup>();
  const stockId = popup?.kind === "stock" ? popup.id : null;
  const editId = popup?.kind === "edit" ? popup.id : null;

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
  const { names, isLoading: namesLoading } = useUserNames(unnamed);
  const users = useMemo(() => {
    const rows = assignments.data ?? [];
    const byVan = containerUserNames(rows, names);
    const byUser = new Map(rows.map((r) => [r.userId, r] as const));
    return new Map(containers.map((c) => [c.id, usersOfContainer(c, byVan, byUser)] as const));
  }, [assignments.data, names, containers]);

  // One skeleton, then the fleet whole: the rows wait for the count (the
  // pager's "of N") and for who works from each van — named a beat after the
  // rows, the Users column read "+1" and then changed. Latched: a new filter
  // keeps the rows on screen, dimmed, not a skeleton.
  const ready = useInventoryPageReady(settled(query) && settled(count) && settled(assignments) && !namesLoading);
  const loading = !ready;
  const empty = !loading && containers.length === 0;
  const skeletonRows = useSkeletonRows(
    TABLE_KEY,
    pageSize,
    count.data?.total,
    loading || pager.isStale ? undefined : containers.length,
  );

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
        <ListBody
          holdKey={JSON.stringify(filter)}
          scrollKey={`${pager.page}:${pageSize}`}
          pager={
            // Drawn with the rows, never under the skeleton, where the rows
            // would move it when they land.
            loading || empty ? null : (
              <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
            )
          }
        >
          {empty ? (
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
                onEdit={(c) => open({ kind: "edit", id: c.id })}
                onStock={(c) => open({ kind: "stock", id: c.id })}
              />
            </>
          )}
        </ListBody>
      </div>

      <ContainerCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      {/* Mounted only while open, so each opening reads fresh. */}
      {stockId ? (
        <LocationStockDialog
          type="container"
          locationId={stockId}
          open
          onOpenChange={(next) => (next ? undefined : close())}
          aside={
            <ContainerTemplateBar
              containerId={stockId}
              // Swapped, not stacked: closing Apply goes back to the list.
              onApply={(templateId) => open({ kind: "apply", templateId, containerId: stockId })}
              onSetTemplate={() => open({ kind: "edit", id: stockId })}
            />
          }
        />
      ) : null}
      {popup?.kind === "apply" ? (
        <ApplyTemplateDialog
          templateId={popup.templateId}
          containerId={popup.containerId}
          open
          onOpenChange={(next) => (next ? undefined : close())}
        />
      ) : null}
      {editId ? (
        <ContainerEditDialog
          containerId={editId}
          open
          onOpenChange={(next) => (next ? undefined : close())}
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
 * page of skeleton rows — and no pager, which the rows would move. It reads
 * nothing — not the list, not "my van".
 */
function FleetFrame() {
  const [pageSize] = usePageSize(TABLE_KEY);
  const skeletonRows = useSkeletonRows(TABLE_KEY, pageSize, undefined, undefined);
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
      </div>
    </div>
  );
}
