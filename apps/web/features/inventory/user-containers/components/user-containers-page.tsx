"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, TriangleAlert, UsersRound } from "lucide-react";
import { UserStatus } from "@bitcrm/types";
import type { User } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { queryKeys } from "@/lib/query-keys";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { arraySource } from "@/lib/paging/array-source";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useDenied } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/inventory/components/no-access";
import { ListBody } from "@/features/inventory/components/list-body";
import { useSkeletonRows } from "@/features/inventory/components/use-skeleton-rows";
import { personName } from "@/features/deals/person-name";
import { fetchAllUsers } from "@/features/technicians/api";
import { useUsers, useUsersCount } from "@/features/users/hooks";
import type { UserFilter } from "@/features/users/api";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { useLinkedPopup, usePopup, type LegacyPopupQuery } from "@/features/inventory/use-popup";
import { useUserContainers } from "../hooks";
import { assignmentOf } from "../lib";
import {
  USER_CONTAINERS_TABLE_KEY,
  UserContainersTable,
  type UserContainerRow,
} from "./user-containers-table";
import { AssignContainerDialog } from "./assign-container-dialog";

const PATH = "/inventory/user-containers";
/** The popup over the list: one user's container assignment. */
type AssignPopup = { kind: "assign"; userId: string };
/** Old links carried it in the query (`?assign=<userId>`). */
const LEGACY: LegacyPopupQuery<AssignPopup> = {
  params: ["assign"],
  parse: (q) => {
    const userId = q.get("assign");
    return userId ? { kind: "assign", userId } : null;
  },
};
/** The list's own key: its page size, column widths and skeleton height are saved under it. */
const TABLE_KEY = USER_CONTAINERS_TABLE_KEY;

const ACTIVE: UserFilter = { status: UserStatus.ACTIVE };

/**
 * Workiz "User containers": every active user and the one van they work from
 * — or All locations, or No access. Reassigning is one popup away, because a
 * tech taking another's van for the day is ordinary.
 */
export function UserContainersPage() {
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
  const [pageSize, setPageSize] = usePageSize(TABLE_KEY);
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
  // The matches, once the directory is here. Until then the page on screen
  // stays, dimmed — a search no longer swaps the table for a skeleton.
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
  const rowsByUser = useMemo(
    () => new Map((assignments.data ?? []).map((r) => [r.userId, r] as const)),
    [assignments.data],
  );
  const vans = useMemo(() => locations.data.filter((l) => l.type === "container"), [locations.data]);
  const rows: UserContainerRow[] = pager.items.map((u) => ({
    userId: u.id,
    name: personName(u) ?? u.id,
    email: u.email,
    assignment: assignmentOf(u.id, rowsByUser, vans),
    // No row of their own: their van, if any, is a legacy one the fleet names.
    pending: !rowsByUser.has(u.id) && locations.isLoading,
  }));

  // A row is drawn once it is whole: the user and their assignment. Drawn
  // before the assignments, every row read "Not set" and then changed.
  const loading =
    (!searched && usersQ.isLoading && !usersQ.data) || (assignments.isLoading && !assignments.data);
  const stale = pager.isStale || (searching && !directory.data);
  const skeletonRows = useSkeletonRows(
    TABLE_KEY,
    pageSize,
    count.data?.total,
    loading || stale ? undefined : rows.length,
  );

  const { popup, open, close } = usePopup(useLinkedPopup(null, LEGACY), PATH);
  const assignId = popup?.userId ?? null;

  const failed = searching ? directory.isError : usersQ.isError && !usersQ.data;
  const empty = !failed && !loading && !stale && rows.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <div className="flex-1 px-6 pb-6">
        <ListBody
          holdKey={searched ? term : ""}
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
              <div className="font-medium">Couldn&apos;t load users</div>
              <Button variant="outline" onClick={() => (searching ? directory.refetch() : usersQ.refetch())}>
                Retry
              </Button>
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <UsersRound className="size-6" />
              </div>
              <div>
                <div className="font-medium">{searching ? "No users match" : "No active users"}</div>
                {searching ? (
                  <p className="mt-1 text-sm text-muted-foreground">Try another name or email.</p>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {/* Loading, loaded or holding the page while a search reads the
                  directory — one table, so nothing under it moves. */}
              <UserContainersTable
                rows={rows}
                loading={loading}
                skeletonRows={skeletonRows}
                stale={stale}
                onAssign={(id) => open({ kind: "assign", userId: id })}
              />
            </>
          )}
        </ListBody>
      </div>

      {/* Mounted only while open, so each opening reads fresh. */}
      {assignId ? (
        <AssignContainerDialog
          userId={assignId}
          user={rows.find((r) => r.userId === assignId)}
          open
          onOpenChange={(next) => (next ? undefined : close())}
        />
      ) : null}
    </div>
  );
}
