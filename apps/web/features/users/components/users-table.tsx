"use client";

import type { ReactNode } from "react";
import type { User } from "@bitcrm/types";
import type { WzGridColumn } from "@/components/workiz/local-grid";
import { WzReportGrid, type WzReportColumn, type WzRowOpenEvent, type WzSortDir } from "@/components/workiz/report-grid";
import { formatTeamCreated } from "@/features/technicians/team-list";
import { formatPhone } from "@/lib/phone";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";
import type { UserRow } from "../users-list";
import { UserRowActions } from "./user-row-actions";

/**
 * The Team grid's chips (pg_technicians_wz_measure_team.json): Workiz's
 * `tag small` — 11px/13px 500 white on its colour, 3px corners, 1px 4px —
 * 8px under the email. "2FA" is Workiz's (#6aa8ee); "Inactive" and "Custom
 * permissions" are ours, in the same shape.
 */
function Chip({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={cn("block w-fit rounded-[3px] px-1 py-px text-[11px] leading-[13px] font-medium tracking-[0.4px] whitespace-nowrap text-white", className)}>
      {children}
    </span>
  );
}

type Column = WzReportColumn<UserRow> & Pick<WzGridColumn<UserRow>, "sortValue">;

/**
 * The columns: Workiz's Team page in its order (pg_technicians_wz_01_team —
 * Name, Phone, Role, Field team, …, Created), with ours where Workiz has
 * Type / Skills / Areas (technician things): Department, and the row's
 * Actions last, as Workiz's Roles grid keeps its.
 */
function columns(onOpen: (u: User, tab?: string) => void): Column[] {
  return [
    {
      id: "name",
      label: "Name",
      sortable: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <>
          <span className="block truncate">{r.name}</span>
          <span className="mt-[5px] block overflow-hidden text-xs leading-4 text-wz-caption">{r.email}</span>
          {r.twoFactor || r.status !== "active" || r.custom ? (
            <span className="mt-2 flex flex-wrap gap-1">
              {r.twoFactor ? <Chip className="bg-wz-link">2FA</Chip> : null}
              {r.status !== "active" ? <Chip className="bg-wz-outline">Inactive</Chip> : null}
              {r.custom ? <Chip className="bg-wz-slate">Custom permissions</Chip> : null}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: "phone",
      label: "Phone",
      sortable: true,
      sortValue: (r) => r.phone,
      cell: (r) =>
        r.phone ? (
          <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="inline-block max-w-full truncate text-wz-link hover:underline">
            {formatPhone(r.phone)}
          </a>
        ) : null,
    },
    { id: "role", label: "Role", sortable: true, sortValue: (r) => r.role, cell: (r) => <span className="block truncate">{r.role}</span> },
    {
      id: "fieldTeam",
      label: "Field team",
      sortable: true,
      sortValue: (r) => (r.fieldTeam ? "yes" : "no"),
      cell: (r) => (r.fieldTeam ? "yes" : "no"),
    },
    {
      id: "department",
      label: "Department",
      sortable: true,
      sortValue: (r) => r.department,
      cell: (r) => <span className="block truncate">{r.department}</span>,
    },
    {
      id: "created",
      label: "Created",
      sortable: true,
      sortValue: (r) => r.createdAt,
      cell: (r) => <span className="block truncate">{formatTeamCreated(r.createdAt)}</span>,
    },
    {
      id: "actions",
      label: "Actions",
      cell: (r) => <UserRowActions user={r.user} name={r.name} onOpen={onOpen} />,
    },
  ];
}

/** Sort keys for `localGridView`, one per sortable column. */
export const USER_SORT_COLUMNS: WzGridColumn<UserRow>[] = columns(() => {})
  .filter((c) => c.sortValue)
  .map((c) => ({ id: c.id, label: c.label, render: () => null, sortValue: c.sortValue }));

/**
 * Workiz's columns share the row alike (175px each on its 1400px grid); ours
 * start at 160 and the fixed table stretches them to the width it has. The
 * Actions column holds only the ••• (Workiz's Roles grid gives its Actions a
 * share like the rest; ours is narrower, the dots needing 40px).
 */
const COLUMN_DEFAULTS: Record<string, number> = {
  name: 160,
  phone: 160,
  role: 160,
  fieldTeam: 160,
  department: 160,
  created: 160,
  actions: 100,
};

/**
 * The Users grid — the Team grid's look (react-table, pg_technicians_wz_01):
 * never shorter than five rows, blanks under records 56px without a rule, an
 * empty grid just its ruled blanks and no words; a row opens the user.
 */
export function UsersTable({
  rows,
  sort,
  onSort,
  onOpen,
  loading = false,
  footer,
}: {
  rows: readonly UserRow[];
  sort: { column: string; dir: WzSortDir } | null;
  onSort: (column: string) => void;
  onOpen: (u: User, tab?: string, event?: WzRowOpenEvent) => void;
  loading?: boolean;
  footer?: ReactNode;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths("users-team", COLUMN_DEFAULTS);
  return (
    <WzReportGrid
      aria-label="Users"
      className="shrink-0"
      columns={columns(onOpen)}
      rows={rows}
      rowKey={(r) => r.id}
      sort={sort}
      onSort={onSort}
      resize={{ widthOf, setWidth, reset }}
      onRowClick={(r, e) => onOpen(r.user, "profile", e)}
      loading={loading}
      minRows={5}
      plainFiller
      emptyText={null}
      footer={footer}
    />
  );
}
