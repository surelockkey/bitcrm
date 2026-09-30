"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, TriangleAlert, UsersRound } from "lucide-react";
import { UserStatus } from "@bitcrm/types";
import type { User } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ListPagination } from "@/components/ui/list-pagination";
import { queryKeys } from "@/lib/query-keys";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { arraySource } from "@/lib/paging/array-source";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { usePermissions } from "@/features/auth/use-permissions";
import { personName } from "@/features/deals/person-name";
import { fetchAllUsers } from "@/features/technicians/api";
import { useUsers, useUsersCount } from "@/features/users/hooks";
import type { UserFilter } from "@/features/users/api";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { useUrlPopups } from "@/features/inventory/use-url-popups";
import { useUserContainers } from "../hooks";
import { assignmentOf } from "../lib";
import { UserContainersTable, type UserContainerRow } from "./user-containers-table";
import { AssignContainerDialog } from "./assign-container-dialog";

const PATH = "/inventory/user-containers";
const POPUPS = ["assign"] as const;
/** The list's own key: its page size and its column widths are saved under it. */
const TABLE_KEY = "inventory-user-containers";

const ACTIVE: UserFilter = { status: UserStatus.ACTIVE };

/**
 * Workiz "User containers": every active user and the one van they work from
 * — or All locations, or No access. Reassigning is one popup away, because a
 * tech taking another's van for the day is ordinary.
 */
export function UserContainersPage() {
  const { can } = usePermissions();
  if (!can("containers", "view")) {
    return <NoAccess text="You don't have permission to view containers." />;
  }
  // The rows are the users directory; without it there is nothing to list.
  if (!can("users", "view")) {
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
  const usersQ = useUsers(ACTIVE, pageSize);
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
  const found = useMemo(
    () =>
      searching
        ? (directory.data ?? [])
            .filter((u) => u.status === UserStatus.ACTIVE && matches(u, term))
            .sort((a, b) => (personName(a) ?? "").localeCompare(personName(b) ?? ""))
        : [],
    [searching, directory.data, term],
  );

  const pager = usePager(
    searching ? arraySource(found, pageSize, directory.isLoading) : pagedSource(usersQ),
    {
      total: searching ? found.length : count.data?.total,
      totalIsFloor: searching ? false : count.data?.atLeast,
      pageSize,
      resetKey: JSON.stringify({ term, pageSize }),
    },
  );

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
  }));

  const popups = useUrlPopups(PATH, POPUPS);
  const assignId = popups.param("assign");

  const loading = searching ? directory.isLoading : usersQ.isLoading;
  const failed = searching ? directory.isError : usersQ.isError;

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
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : failed ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <TriangleAlert className="size-6" />
            </div>
            <div className="font-medium">Couldn&apos;t load users</div>
            <Button variant="outline" onClick={() => (searching ? directory.refetch() : usersQ.refetch())}>
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
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
            <UserContainersTable rows={rows} onAssign={(id) => popups.open("assign", id)} />
            <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
          </>
        )}
      </div>

      {/* Mounted only while the param is set, so each opening reads fresh. */}
      {assignId ? (
        <AssignContainerDialog
          userId={assignId}
          user={rows.find((r) => r.userId === assignId)}
          open
          onOpenChange={(open) => (open ? undefined : popups.close())}
        />
      ) : null}
    </div>
  );
}

function NoAccess({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">No access</h2>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
