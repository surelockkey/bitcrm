"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserStatus } from "@bitcrm/types";
import type { User } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { WZ_GRID_PAGE_SIZES } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { queryKeys } from "@/lib/query-keys";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled } from "@/lib/use-page-ready";
import { arraySource } from "@/lib/paging/array-source";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { useInventoryPageReady } from "@/features/inventory/components/inventory-frame";
import { NoAccess } from "@/features/inventory/components/no-access";
import { personName } from "@/features/deals/person-name";
import { useRoles } from "@/features/roles/hooks";
import { fetchAllUsers } from "@/features/technicians/api";
import { useUsers, useUsersCount } from "@/features/users/hooks";
import type { UserFilter } from "@/features/users/api";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { useDropStaleParams } from "@/features/inventory/use-popup";
import { useAssignUserContainer, useUserContainers } from "../hooks";
import type { AssignUserContainerBody } from "../api";
import { assignmentOf, locationChoices } from "../lib";
import { USER_CONTAINERS_TABLE_KEY, UserContainersTable, type UserContainerRow } from "./user-containers-table";

/** The users the tab lists — the same key the tab row's counter reads. */
const ACTIVE: UserFilter = { status: UserStatus.ACTIVE };

/**
 * Workiz's "User locations" (pg_inventory_wz_02_user-locations): every active
 * user, their role, the Location box (All, No access or the one van they work
 * from) and the Restricted switch — both saving at once, as Workiz's do. A
 * tech taking another's van for the day is one pick; the server logs it.
 */
export function UserContainersPage() {
  // An old ?assign= link lands on the plain list — the popup it opened is gone.
  useDropStaleParams(["assign"]);
  // Refused only once the permissions are known — never a flash of "No access".
  const denied = useDenied();
  if (denied("containers", "view")) {
    return <NoAccess text="You don't have permission to view containers." />;
  }
  // The rows are the users directory; without it there is nothing to list.
  if (denied("users", "view")) {
    return <NoAccess text="Assigning containers needs permission to view users." />;
  }
  return <Assignments />;
}

function matches(u: User, term: string): boolean {
  const hay = `${u.firstName ?? ""} ${u.lastName ?? ""} ${u.email ?? ""}`.toLowerCase();
  return hay.includes(term.toLowerCase());
}

function Assignments() {
  const { can, isLoading: permsLoading } = usePermissions();
  const [pageSize, setPageSize] = usePageSize(USER_CONTAINERS_TABLE_KEY, { sizes: WZ_GRID_PAGE_SIZES, fallback: 10 });
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), 300);
  const searching = term.length > 0;

  // A page at a time from the server — the users service filters by status.
  // A new page size keeps the page on screen, dimmed, until the next lands.
  const usersQ = useUsers(ACTIVE, pageSize, { keepPrevious: true });
  const count = useUsersCount(ACTIVE);
  // It can't search, though, and filtering the one page on screen would miss
  // everyone on the others: a search reads the whole directory (the same
  // cache every name lookup in the app shares) and pages what matches.
  const directory = useQuery({
    queryKey: queryKeys.technicians.userMap(),
    queryFn: fetchAllUsers,
    enabled: searching,
    staleTime: 5 * 60 * 1000,
  });
  const searched = searching && !!directory.data;
  const found = useMemo(
    () =>
      searched
        ? (directory.data ?? [])
            .filter((u) => u.status === UserStatus.ACTIVE && matches(u, term))
            .sort((a, b) => (personName(a) ?? "").localeCompare(personName(b) ?? ""))
        : [],
    [searched, directory.data, term],
  );

  const pager = usePager(searched ? arraySource(found, pageSize) : pagedSource(usersQ), {
    total: searched ? found.length : count.data?.total,
    totalIsFloor: searched ? false : count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ term: searched ? term : "", pageSize }),
  });

  // Every assignment in one request, joined here by user id; a user without
  // one falls back to the van that names them as its technician.
  const assignments = useUserContainers();
  const locations = useAllLocations();
  // Workiz's Role column — the role's name, for a reader who may see the roles.
  const canRoles = !permsLoading && can("roles", "view");
  const roles = useRoles(canRoles);
  const roleNames = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r.name] as const)), [roles.data]);
  const rowsByUser = useMemo(
    () => new Map((assignments.data ?? []).map((r) => [r.userId, r] as const)),
    [assignments.data],
  );
  const vans = useMemo(() => locations.data.filter((l) => l.type === "container"), [locations.data]);
  const choices = useMemo(() => locationChoices(locations.data), [locations.data]);
  const rows: UserContainerRow[] = pager.items.map((u) => ({
    userId: u.id,
    name: personName(u) ?? u.id,
    email: u.email,
    role: u.roleId ? roleNames.get(u.roleId) : undefined,
    assignment: assignmentOf(u.id, rowsByUser, vans),
    // No row of their own: their van, if any, is a legacy one the fleet names.
    pending: !rowsByUser.has(u.id) && locations.isLoading,
  }));

  // One loader, then the grid whole: a row is drawn once it is complete — the
  // user, their role, their assignment and the van it names — with the
  // pager's "of N". Latched: a search or a new page size keeps the rows on
  // screen, dimmed.
  const ready = useInventoryPageReady(
    !permsLoading &&
      settled(usersQ) &&
      settled(count) &&
      settled(assignments) &&
      !locations.isLoading &&
      (!canRoles || settled(roles)),
  );
  const stale = pager.isStale || (searching && !directory.data);
  const failed = searching ? directory.isError : usersQ.isError && !usersQ.data;

  // Each pick saves at once; the row's controls wait while it does.
  const assign = useAssignUserContainer();
  const [saving, setSaving] = useState<string | null>(null);
  const onAssign = useCallback(
    (userId: string, body: AssignUserContainerBody) => {
      setSaving(userId);
      assign.mutate({ userId, body }, { onSettled: () => setSaving(null) });
    },
    [assign],
  );

  return (
    <div className="flex flex-col">
      {/* Workiz's strip sits right under the tab rule: Search, the page size. */}
      <WzListToolbar data-testid="user-locations-toolbar" className="shrink-0">
        <WzSearchBox type="search" aria-label="Search users" value={search} onChange={setSearch} />
        <WzPageSizeSelect className="ml-auto" value={pageSize} sizes={WZ_GRID_PAGE_SIZES} onChange={setPageSize} />
      </WzListToolbar>

      {failed ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p role="alert">Couldn&apos;t load users</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => (searching ? directory.refetch() : usersQ.refetch())}
          >
            Retry
          </Button>
        </div>
      ) : (
        <UserContainersTable
          rows={rows}
          choices={choices}
          canEdit={can("containers", "edit")}
          saving={saving}
          onAssign={onAssign}
          loading={!ready}
          stale={stale}
          // Drawn with the rows, its total and all — never under the loader.
          footer={ready ? <WzPager pager={pager} plainNumbers /> : null}
        />
      )}
    </div>
  );
}
