"use client";

import type { ReactNode } from "react";
import { Glasses } from "lucide-react";
import type { WzGridColumn } from "@/components/workiz/local-grid";
import { WzReportGrid, type WzReportColumn, type WzRowOpenEvent, type WzSortDir } from "@/components/workiz/report-grid";
import { formatPhone } from "@/lib/phone";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";
import { formatTeamCreated, TEAM_TYPE_LABEL, type TeamRow } from "../team-list";

/** Workiz splits a list cell's names with " ," ("SURE LOCK CT ,SURE LOCK NY", pg_technicians_wz_06_search_bohdan). */
const joinNames = (names: string[]) => names.join(" ,");

/**
 * The Team grid's chips (pg_technicians_wz_measure_team.json): Workiz's
 * `tag small` — 11px/13px 500 white on its colour, 3px corners, 1px 4px —
 * 8px under the email. "2FA" is Workiz's (#6aa8ee); "Pending" and
 * "Inactive" are ours, in the same shape.
 */
function Chip({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={cn("block w-fit rounded-[3px] px-1 py-px text-[11px] leading-[13px] font-medium tracking-[0.4px] text-white", className)}>
      {children}
    </span>
  );
}

const STATUS_CHIP: Partial<Record<TeamRow["status"], { label: string; className: string }>> = {
  pending: { label: "Pending", className: "bg-warning" },
  inactive: { label: "Inactive", className: "bg-wz-outline" },
};

/**
 * The columns in Workiz's order (pg_technicians_wz_01_team). Each also says
 * how it sorts and what Search reads in it, for `localGridView`.
 */
export const TEAM_COLUMNS: (WzReportColumn<TeamRow> & Pick<WzGridColumn<TeamRow>, "sortValue" | "searchText">)[] = [
  {
    id: "name",
    label: "Name",
    sortable: true,
    sortValue: (r) => r.name,
    searchText: (r) => `${r.name} ${r.email ?? ""}`,
    cell: (r) => {
      const status = STATUS_CHIP[r.status];
      return (
        <>
          <span className="block truncate">{r.name}</span>
          {r.email ? <span className="mt-[5px] block overflow-hidden text-xs leading-4 text-wz-caption">{r.email}</span> : null}
          {r.twoFactor || status ? (
            <span className="mt-2 flex gap-1">
              {r.twoFactor ? <Chip className="bg-wz-link">2FA</Chip> : null}
              {status ? <Chip className={status.className}>{status.label}</Chip> : null}
            </span>
          ) : null}
        </>
      );
    },
  },
  {
    id: "phone",
    label: "Phone",
    sortable: true,
    sortValue: (r) => r.phone,
    searchText: (r) => (r.phone ? `${r.phone} ${formatPhone(r.phone)}` : ""),
    cell: (r) => (
      <>
        {r.phone ? (
          <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="inline-block truncate text-wz-link hover:underline">
            {formatPhone(r.phone)}
          </a>
        ) : null}
        {r.callMasking ? (
          // team-module__callMaskingTag: #3589e9, 4px corners, 0 4px, 13px/19px white, the glyph after the words.
          <span className="mt-[5px] flex w-fit items-center gap-1 rounded-[4px] bg-brand px-1 text-[13px] leading-[19px] text-white">
            Call masking
            <Glasses className="size-4" strokeWidth={1.75} aria-hidden />
          </span>
        ) : null}
      </>
    ),
  },
  { id: "role", label: "Role", sortable: true, sortValue: (r) => r.role, cell: (r) => <span className="block truncate">{r.role}</span> },
  {
    id: "fieldTeam",
    label: "Field team",
    sortable: true,
    sortValue: (r) => (r.fieldTeam ? "yes" : "no"),
    cell: (r) => (r.fieldTeam ? "yes" : "no"),
  },
  { id: "type", label: "Type", sortable: true, sortValue: (r) => TEAM_TYPE_LABEL[r.type], cell: (r) => TEAM_TYPE_LABEL[r.type] },
  {
    id: "created",
    label: "Created",
    sortable: true,
    sortValue: (r) => r.createdAt,
    cell: (r) => <span className="block truncate">{formatTeamCreated(r.createdAt)}</span>,
  },
  {
    id: "skills",
    label: "Skills",
    sortable: true,
    sortValue: (r) => joinNames(r.skills),
    cell: (r) => <span className="block truncate">{joinNames(r.skills)}</span>,
  },
  {
    id: "areas",
    label: "Areas",
    sortable: true,
    sortValue: (r) => joinNames(r.areas),
    cell: (r) => <span className="block truncate">{joinNames(r.areas)}</span>,
  },
];

/**
 * Workiz's columns share the row alike (175px each on its 1400px grid). Ours
 * start at 160 and the fixed table stretches them alike to the width it has —
 * 175 would overrun our 8px-narrower page and scroll it sideways. The reader
 * may drag them.
 */
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(TEAM_COLUMNS.map((c) => [c.id, 160] as const));

/**
 * The Team grid (react-table, pg_technicians_wz_01_team): the report grid
 * with Workiz's Team settings — never shorter than five rows, blanks under
 * records 56px without a rule, an empty grid just its ruled blanks and no
 * words (pg_technicians_wz_07_search_empty); a row opens the technician.
 */
export function TechniciansTable({
  rows,
  sort,
  onSort,
  onOpen,
  loading = false,
  footer,
}: {
  rows: readonly TeamRow[];
  sort: { column: string; dir: WzSortDir } | null;
  onSort: (column: string) => void;
  onOpen: (row: TeamRow, event: WzRowOpenEvent) => void;
  loading?: boolean;
  footer?: ReactNode;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths("technicians-team", COLUMN_DEFAULTS);
  return (
    <WzReportGrid
      aria-label="Technicians"
      className="shrink-0"
      columns={TEAM_COLUMNS}
      rows={rows}
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
