"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { Role } from "@bitcrm/types";
import { WzButton } from "@/components/workiz/button";
import { localGridView, nextGridSort, WZ_GRID_PAGE_SIZES, type WzGridSort } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import type { WzRowOpenEvent } from "@/components/workiz/report-grid";
import { WzSettingsExplain } from "@/components/workiz/settings-explain";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { usePermissions } from "@/features/auth/use-permissions";
import { usePageSize } from "@/lib/paging/use-page-size";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useRoles, useRoleMemberCounts } from "../hooks";
import { sortRolesByPriority } from "../lib";
import { useRoleAccess } from "../use-role-access";
import { CreateRoleDialog } from "./create-role-dialog";
import { DeleteRoleDialog } from "./delete-role-dialog";
import { RolesTable, roleSortColumns } from "./roles-table";

/** Workiz's `lnr-user-lock` (Settings → Roles & Permissions): a person with a padlock at the foot. */
export function UserLockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <circle cx="10" cy="7" r="4" />
      <path d="M3 21v-1a7 7 0 0 1 10.5-6.06" />
      <rect x="14.5" y="16" width="7" height="5" rx="1" />
      <path d="M16 16v-1.5a2 2 0 0 1 4 0V16" />
    </svg>
  );
}

const NO_ROLES: Role[] = [];

/**
 * Admin → Roles as Workiz's Settings → Roles & Permissions (`/root/roles`,
 * pg_admin_users_wz_01_roles): the settings band in Workiz's words, the
 * yellow "Add New Role" 20px under it, the grey strip with Search and the
 * page size, the grid (Role … Actions, a custom role's yellow "Delete Role"),
 * Workiz's pager. A row opens the role's permissions.
 *
 * The grid waits for every role's member count (they used to fill one cell
 * at a time under grey bars), and the add button comes with it.
 */
export function RolesPage() {
  const router = useRouter();
  const { isLoading: permsLoading } = usePermissions();
  const { canViewRoles, canCreateRoles, canDeleteRoles, editabilityOf } = useRoleAccess();
  const rolesQuery = useRoles();

  const roles = useMemo(() => rolesQuery.data ?? NO_ROLES, [rolesQuery.data]);
  const { counts, ready: countsIn } = useRoleMemberCounts(roles.map((r) => r.id));
  const ready = usePageReady(!permsLoading && settled(rolesQuery) && countsIn);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WzGridSort | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize("roles", { sizes: WZ_GRID_PAGE_SIZES, fallback: 10 });
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const view = useMemo(() => {
    // Unsorted, the most powerful role first (ours: the hierarchy reads top down).
    const q = query.trim().toLowerCase();
    const found = sortRolesByPriority(roles).filter(
      (r) => !q || `${r.name} ${r.description ?? ""}`.toLowerCase().includes(q),
    );
    return localGridView(found, roleSortColumns(counts), { query: "", sort, page, size });
  }, [roles, counts, query, sort, page, size]);

  if (!permsLoading && !canViewRoles) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view roles.</p>
      </div>
    );
  }

  const open = (role: Role, event: WzRowOpenEvent) => {
    const href = `/admin/roles/${role.id}`;
    const newTab = "button" in event && (event.metaKey || event.ctrlKey || event.button === 1);
    if (newTab) window.open(href, "_blank", "noopener");
    else router.push(href);
  };

  return (
    <div className="flex flex-1 flex-col">
      <WzSettingsExplain icon={<UserLockIcon />} title="Roles & Permissions">
        Control what your team can see or do on your account, edit your account permission roles or create new custom
        roles.
      </WzSettingsExplain>

      {/* Workiz's `_wp`: the add button 20px in and 20px under the band, 20px over the strip. */}
      <div className="flex h-[72px] shrink-0 items-center px-5">
        {ready && canCreateRoles ? (
          <WzButton size="regular" icon={<Plus className="size-[18px]" strokeWidth={2.5} />} onClick={() => setCreateOpen(true)}>
            Add New Role
          </WzButton>
        ) : null}
      </div>

      <WzListToolbar>
        <WzSearchBox
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

      {ready && rolesQuery.isError ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm text-wz-strong">
          <p role="alert">Couldn&apos;t load roles</p>
          <WzButton variant="secondary" size="regular" className="mt-3" onClick={() => rolesQuery.refetch()}>
            Try again
          </WzButton>
        </div>
      ) : (
        <RolesTable
          roles={ready ? view.rows : NO_ROLES}
          memberCounts={counts}
          canDelete={canDeleteRoles}
          sort={sort ? { column: sort.id, dir: sort.dir } : null}
          onSort={(column) => {
            setSort((s) => nextGridSort(s, column));
            setPage(1);
          }}
          onOpen={open}
          onDelete={setDeleting}
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

      {/* Mounted when asked for: its defaults (the role to copy, the rank) read the roles as they are then. */}
      {createOpen ? <CreateRoleDialog open onOpenChange={setCreateOpen} roles={roles} /> : null}
      {deleting ? (
        <DeleteRoleDialog
          role={deleting}
          editability={editabilityOf(deleting, counts[deleting.id])}
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}
