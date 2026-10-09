"use client";

import { useCallback, useMemo, useState } from "react";
import { DataScope, InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WzButtonLink } from "@/components/workiz/button";
import { WZ_GRID_PAGE_SIZES } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled } from "@/lib/use-page-ready";
import { useInventoryPageReady } from "@/features/inventory/components/inventory-frame";
import { LocationsBand } from "@/features/inventory/components/locations-grid";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { LocationStockDialog } from "@/features/inventory/stock/components/location-stock-dialog";
import { ContainerTemplateBar } from "@/features/inventory/templates/components/container-template-bar";
import { ApplyTemplateDialog } from "@/features/inventory/templates/components/apply-template-dialog";
import { useDropStaleParams, usePopup } from "@/features/inventory/use-popup";
import { useUserContainers, useUserNames } from "@/features/inventory/user-containers/hooks";
import { containerUserNames, unnamedUserIds, usersOfContainer } from "@/features/inventory/user-containers/lib";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useContainersList, useContainersCount } from "../hooks";
import type { ContainerFilter } from "../api";
import { CONTAINERS_TABLE_KEY, ContainersTable } from "./containers-table";
import { ContainerCreateDialog } from "./container-create-dialog";
import { ContainerEditDialog } from "./container-edit-dialog";
import { MyContainerView } from "./my-container-view";

/** Workiz's page size before the reader picks one. */
const PAGE_SIZE = { sizes: WZ_GRID_PAGE_SIZES, fallback: 10 };

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

/**
 * The vans — Workiz's Locations tab (pg_inventory_wz_02_locations) for the
 * mobile locations, the owner's split from the warehouses: Add New in the
 * band (with BitCRM's link to Technicians beside it); the strip with Search,
 * BitCRM's Department and Status boxes and the page size; the grid with the
 * pager in it. The pencil opens Workiz's Edit Location, the box (or the row)
 * the van's Manage stock.
 */
function Fleet() {
  const { can } = usePermissions();
  const [pageSize, setPageSize] = usePageSize(CONTAINERS_TABLE_KEY, PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  // A van has no page of its own: its stock and its settings open over the
  // list as state; an old /inventory/containers/<id> link lands on the list.
  const { popup, open, close } = usePopup<ContainersPopup>();
  const stockId = popup?.kind === "stock" ? popup.id : null;
  const editId = popup?.kind === "edit" ? popup.id : null;
  const onEdit = useCallback((c: Container) => open({ kind: "edit", id: c.id }), [open]);
  const onStock = useCallback((c: Container) => open({ kind: "stock", id: c.id }), [open]);

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
  const src = pagedSource(query);
  const pager = usePager(query.isPlaceholderData ? { ...src, hasNextPage: false } : src, {
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
      [...new Set(locations.data.map((l) => l.department).filter((d): d is string => !!d))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [locations.data],
  );

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

  // One loader, then the fleet whole: the rows wait for the count (the
  // pager's "of N") and for who works from each van — named a beat after the
  // rows, the Users column read "+1" and then changed. Latched: a new filter
  // keeps the rows on screen, dimmed.
  const ready = useInventoryPageReady(settled(query) && settled(count) && settled(assignments) && !namesLoading);
  const failed = query.isError && !query.data;

  return (
    <div className="flex flex-col">
      <FleetChrome
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
        pageSize={pageSize}
        onPageSize={setPageSize}
      />

      {failed ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p role="alert">Couldn&apos;t load containers</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <ContainersTable
          containers={containers}
          users={users}
          loading={!ready}
          stale={query.isPlaceholderData}
          onEdit={onEdit}
          onStock={onStock}
          // Drawn with the rows, its total and all — never under the loader.
          footer={ready ? <WzPager pager={pager} plainNumbers /> : null}
        />
      )}

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
        <ContainerEditDialog containerId={editId} open onOpenChange={(next) => (next ? undefined : close())} />
      ) : null}
    </div>
  );
}

/**
 * The band and the strip. Every control is there from the first frame: the
 * Department box waits (disabled) for the departments instead of popping in
 * and pushing Status and the page size sideways.
 */
function FleetChrome({
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
  pageSize,
  onPageSize,
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
  pageSize: number;
  onPageSize: (size: number) => void;
  /** Permissions still loading: everything in place, nothing to press yet. */
  pending?: boolean;
}) {
  return (
    <>
      <LocationsBand canAdd={pending || canCreate} pending={pending} onAdd={onCreate}>
        {/* BitCRM's way to who drives the vans; Workiz has none. */}
        <WzButtonLink href="/technicians" variant="secondary" size="regular">
          Technicians
        </WzButtonLink>
      </LocationsBand>
      <WzListToolbar data-testid="containers-toolbar" className="shrink-0">
        <WzSearchBox value={search} onChange={onSearch} disabled={pending} />
        {/* BitCRM's own boxes: vans by department, archived ones findable. */}
        <Select value={department} onValueChange={onDepartment} disabled={pending || departmentsLoading}>
          <SelectTrigger className="h-10 w-[200px]" aria-label="Department">
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
          <SelectTrigger className="h-10 w-[200px]" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value={InventoryStatus.ACTIVE}>Active</SelectItem>
            <SelectItem value={InventoryStatus.ARCHIVED}>Archived</SelectItem>
          </SelectContent>
        </Select>
        <WzPageSizeSelect className="ml-auto" value={pageSize} sizes={WZ_GRID_PAGE_SIZES} onChange={onPageSize} />
      </WzListToolbar>
    </>
  );
}

const noop = () => {};

/**
 * The fleet as it will look, before anything is known: the band, the strip
 * and the grid's header over Workiz's loader — no pager. It reads nothing —
 * not the list, not "my van".
 */
function FleetFrame() {
  const [pageSize] = usePageSize(CONTAINERS_TABLE_KEY, PAGE_SIZE);
  return (
    <div className="flex flex-col">
      <FleetChrome
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
        pageSize={pageSize}
        onPageSize={noop}
        pending
      />
      <ContainersTable containers={[]} users={new Map()} loading onEdit={noop} onStock={noop} />
    </div>
  );
}
