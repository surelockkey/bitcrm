"use client";

import type { ReactNode } from "react";
import type { Role } from "@bitcrm/types";
import { WzButton } from "@/components/workiz/button";
import { WzTrashIcon } from "@/components/workiz/icons";
import type { WzGridColumn } from "@/components/workiz/local-grid";
import { WzReportGrid, type WzReportColumn, type WzRowOpenEvent, type WzSortDir } from "@/components/workiz/report-grid";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { dominantScope, isSuperAdmin, scopeLabel } from "../lib";

type Column = WzReportColumn<Role> & Pick<WzGridColumn<Role>, "sortValue">;

/** "Locked", in the Team grid's `tag small` shape (11px/13px 500 white, 3px corners). */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="ml-2 inline-block rounded-[3px] bg-wz-outline px-1 py-px align-[1px] text-[11px] leading-[13px] font-medium tracking-[0.4px] text-white">
      {children}
    </span>
  );
}

export const typeLabel = (r: Role) => (r.isSystem ? "System" : "Custom");

/**
 * The columns: Workiz's Role first and Actions last
 * (pg_admin_users_wz_01_roles); ours between them, as the Team grid keeps
 * its extra columns — Type, Priority, Default scope, Members.
 */
function columns({
  memberCounts,
  canDelete,
  onDelete,
}: {
  memberCounts: Record<string, number | undefined>;
  canDelete: boolean;
  onDelete: (role: Role) => void;
}): Column[] {
  return [
    {
      id: "role",
      label: "Role",
      sortable: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <>
          <span className="block truncate">{r.name}</span>
          {r.description ? (
            <span className="mt-[5px] block overflow-hidden text-xs leading-4 text-ellipsis text-wz-caption">{r.description}</span>
          ) : null}
        </>
      ),
    },
    {
      id: "type",
      label: "Type",
      sortable: true,
      sortValue: typeLabel,
      cell: (r) => (
        <span className="block truncate">
          {typeLabel(r)}
          {isSuperAdmin(r) ? <Chip>Locked</Chip> : null}
        </span>
      ),
    },
    { id: "priority", label: "Priority", sortable: true, sortValue: (r) => r.priority, cell: (r) => r.priority },
    {
      id: "scope",
      label: "Default scope",
      sortable: true,
      sortValue: (r) => scopeLabel(dominantScope(r.dataScope)),
      cell: (r) => <span className="block truncate">{scopeLabel(dominantScope(r.dataScope))}</span>,
    },
    {
      id: "members",
      label: "Members",
      sortable: true,
      sortValue: (r) => memberCounts[r.id],
      cell: (r) => memberCounts[r.id] ?? "",
    },
    {
      id: "actions",
      label: "Actions",
      // Workiz's yellow "Delete Role" (a trash glyph, 32px regular) on every
      // role a person made; its own two (admin, tech) carry nothing. Ours
      // asks first, and says why when the role cannot go yet.
      cell: (r) =>
        canDelete && !r.isSystem ? (
          <WzButton
            size="regular"
            icon={<WzTrashIcon size={15} />}
            aria-label={`Delete Role ${r.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(r);
            }}
          >
            Delete Role
          </WzButton>
        ) : null,
    },
  ];
}

/** The sort keys for `localGridView`, one per sortable column. */
export function roleSortColumns(memberCounts: Record<string, number | undefined>): WzGridColumn<Role>[] {
  return columns({ memberCounts, canDelete: false, onDelete: () => {} })
    .filter((c) => c.sortValue)
    .map((c) => ({ id: c.id, label: c.label, render: () => null, sortValue: c.sortValue, searchText: undefined }));
}

/** Workiz's two columns split its 1400px grid alike; ours start at 160 and stretch. */
const COLUMN_DEFAULTS: Record<string, number> = {
  role: 320,
  type: 160,
  priority: 120,
  scope: 160,
  members: 120,
  actions: 200,
};

/**
 * The Roles & Permissions grid (react-table, pg_admin_users_wz_01_roles):
 * never shorter than five rows, blanks under records 56px without a rule, an
 * empty search just its ruled blanks; a row opens the role's editor.
 */
export function RolesTable({
  roles,
  memberCounts,
  canDelete,
  sort,
  onSort,
  onOpen,
  onDelete,
  loading = false,
  footer,
}: {
  roles: readonly Role[];
  memberCounts: Record<string, number | undefined>;
  canDelete: boolean;
  sort: { column: string; dir: WzSortDir } | null;
  onSort: (column: string) => void;
  onOpen: (role: Role, event: WzRowOpenEvent) => void;
  onDelete: (role: Role) => void;
  loading?: boolean;
  footer?: ReactNode;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths("roles-workiz", COLUMN_DEFAULTS);
  return (
    <WzReportGrid
      aria-label="Roles"
      className="shrink-0"
      columns={columns({ memberCounts, canDelete, onDelete })}
      rows={roles}
      rowKey={(r) => r.id}
      sort={sort}
      onSort={onSort}
      resize={{ widthOf, setWidth, reset }}
      onRowClick={onOpen}
      loading={loading}
      minRows={5}
      plainFiller
      emptyText={null}
      footer={footer}
    />
  );
}
