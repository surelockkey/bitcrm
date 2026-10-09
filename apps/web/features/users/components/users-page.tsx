"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, UsersRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzFilterSelect, type WzFilterPick } from "@/components/workiz/filter-select";
import { localGridView, nextGridSort, WZ_GRID_PAGE_SIZES, type WzGridSort } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzSettingsExplain } from "@/components/workiz/settings-explain";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import type { User } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useUserMap } from "@/features/technicians/hooks";
import { usePageSize } from "@/lib/paging/use-page-size";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useRoles, useUser } from "../hooks";
import { DEFAULT_USER_FILTER, filterUsers, searchUsers, userFilterGroups, userRows, type UserRow } from "../users-list";
import { CreateUserSheet } from "./create-user-sheet";
import { UserDetailSheet } from "./user-detail-sheet";
import { USER_SORT_COLUMNS, UsersTable } from "./users-table";

const NO_ROWS: UserRow[] = [];

/**
 * Admin → Users as a sibling of the Technicians list, which is Workiz's Team
 * page (`/root/team`, pg_technicians_wz_01_team): the settings band, "Filter
 * results" opening on "status: Active" with "+ Add New" beside it, the grey
 * strip with Search and the page size, the Team grid, Workiz's pager.
 *
 * Every account is read (the directory the Team page reads, from the same
 * cache), so the status, role, field-team and department picks combine and
 * Search finds anyone — the paged endpoint takes one filter at a time. The
 * page shows once the people and the role names are in.
 */
export function UsersPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const router = useRouter();
  const searchParams = useSearchParams();

  const directory = useUserMap();
  const rolesQuery = useRoles();
  const ready = usePageReady(!permsLoading && [directory, rolesQuery].every(settled));

  const [picks, setPicks] = useState<WzFilterPick[]>(DEFAULT_USER_FILTER);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WzGridSort | null>({ id: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize("users", { sizes: WZ_GRID_PAGE_SIZES, fallback: 10 });
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<{ user: User; tab: string } | null>(null);

  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const users = useMemo(() => [...(directory.data?.values() ?? [])], [directory.data]);
  const rows = useMemo(() => userRows(users, roles), [users, roles]);
  const groups = useMemo(
    () => userFilterGroups({ roles, departments: users.map((u) => u.department ?? "") }),
    [roles, users],
  );
  const view = useMemo(
    () => localGridView(searchUsers(filterUsers(rows, picks), query), USER_SORT_COLUMNS, { query: "", sort, page, size }),
    [rows, picks, query, sort, page, size],
  );

  // Deep link (`?user=<id>`, e.g. from a name in the call log): open that
  // user's sheet — fetched on its own only when the directory lacks them.
  const linkedId = searchParams.get("user") ?? undefined;
  const { data: linkedUser } = useUser(ready && linkedId && !directory.data?.has(linkedId) ? linkedId : undefined);

  // Keep the open sheet showing the freshest copy from the directory.
  const activeId = selected?.user.id ?? linkedId;
  const currentUser = activeId
    ? (directory.data?.get(activeId) ?? (selected?.user.id === activeId ? selected.user : linkedUser) ?? null)
    : null;

  const openUser = (user: User, tab = "profile") => setSelected({ user, tab });
  const closeUser = () => {
    setSelected(null);
    if (linkedId) router.replace("/admin/users");
  };

  if (!permsLoading && !can("users", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view users.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <WzSettingsExplain icon={<UsersRound />} title="Users">
        Manage and add users to your team
      </WzSettingsExplain>

      {/* The filter row, as the Team page's (pg_technicians_wz_01_team):
          Filter results two thirds wide from 21px in, "+ Add New" 31px after
          it, 20px under the band and 36px over the strip. */}
      <div className="flex items-start pt-5 pb-9">
        <div className="ml-[21px] w-[calc(66.666%-37px)] min-w-0">
          {ready ? (
            <WzFilterSelect
              groups={groups}
              value={picks}
              onChange={(next) => {
                setPicks(next);
                setPage(1);
              }}
            />
          ) : (
            <Skeleton className="h-[38px] w-full" />
          )}
        </div>
        <div className="ml-[31px] flex items-center">
          {ready && can("users", "create") ? (
            <WzButton size="regular" icon={<Plus className="size-[18px]" strokeWidth={2.5} />} onClick={() => setCreateOpen(true)}>
              Add New
            </WzButton>
          ) : null}
        </div>
      </div>

      <WzListToolbar>
        <WzSearchBox
          // A search box without the browser's own blue × beside Workiz's round one.
          role="searchbox"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
        />
        <WzPageSizeSelect
          className="ml-auto"
          value={size}
          sizes={WZ_GRID_PAGE_SIZES}
          onChange={(n) => {
            setSize(n);
            setPage(1);
          }}
        />
      </WzListToolbar>

      {ready && directory.isError ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm text-wz-strong">
          <p role="alert">Couldn&apos;t load users</p>
          <WzButton variant="secondary" size="regular" className="mt-3" onClick={() => directory.refetch()}>
            Try again
          </WzButton>
        </div>
      ) : (
        <UsersTable
          rows={ready ? view.rows : NO_ROWS}
          sort={sort ? { column: sort.id, dir: sort.dir } : null}
          onSort={(column) => {
            setSort((s) => nextGridSort(s, column));
            setPage(1);
          }}
          onOpen={openUser}
          loading={!ready}
          footer={
            ready ? (
              <WzPager
                plainNumbers
                pager={{
                  page: view.page,
                  from: view.from,
                  to: view.to,
                  total: view.total,
                  totalPages: view.pages,
                  canPrev: view.page > 1,
                  canNext: view.page < view.pages,
                  isFetching: false,
                  prev: () => setPage(view.page - 1),
                  next: () => setPage(view.page + 1),
                }}
              />
            ) : null
          }
        />
      )}

      {/* Mounted only when asked for, so the list loads nothing extra. */}
      {createOpen ? <CreateUserSheet open onOpenChange={setCreateOpen} /> : null}
      {currentUser ? (
        <UserDetailSheet key={currentUser.id} user={currentUser} defaultTab={selected?.tab} onClose={closeUser} />
      ) : null}
    </div>
  );
}
