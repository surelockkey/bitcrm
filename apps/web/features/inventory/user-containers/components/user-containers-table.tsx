"use client";

import { useMemo, type ReactNode } from "react";
import { UserContainerAccess } from "@bitcrm/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { INVENTORY_ROW_HEIGHTS } from "@/features/inventory/row-heights";
import { WzWideSwitch } from "@/components/workiz/wide-switch";
import { formatDate } from "@/features/users/lib";
import { assignmentBody, locationChoice, type Assignment } from "../lib";
import type { AssignUserContainerBody } from "../api";

/** One user and what they work from. */
export interface UserContainerRow {
  userId: string;
  name: string;
  email?: string;
  /** Their role's name, when the reader may see the roles. */
  role?: string;
  assignment: Assignment;
  /**
   * No assignment row, and the fleet that may hold their legacy van is still
   * loading: the row waits rather than reading "Not set" and changing.
   */
  pending?: boolean;
}

/**
 * Workiz's User locations grid (pg_inventory_wz_02_user-locations): Name ·
 * Role · Location 200 (the box itself) · Restricted 200 (the wide switch) —
 * and BitCRM's own Updated (who changed it, when) at the end.
 */
export const USER_CONTAINER_COLUMNS: { id: string; label: string; width?: number }[] = [
  { id: "name", label: "Name" },
  { id: "role", label: "Role" },
  { id: "location", label: "Location", width: 200 },
  { id: "restricted", label: "Restricted", width: 200 },
  { id: "updated", label: "Updated", width: 150 },
];

export const USER_CONTAINERS_TABLE_KEY = "inventory-user-containers";

const NO_ROWS: UserContainerRow[] = [];

export function UserContainersTable({
  rows,
  choices,
  canEdit,
  saving,
  onAssign,
  loading = false,
  stale = false,
  footer,
}: {
  rows: UserContainerRow[];
  /** The Location box's list: All, No access, the active vans. */
  choices: { value: string; label: string }[];
  /** `containers.edit`: without it the boxes and switches are read-only. */
  canEdit: boolean;
  /** The user whose row is being saved — their controls wait. */
  saving?: string | null;
  onAssign: (userId: string, body: AssignUserContainerBody) => void;
  /** First load: the header and Workiz's loader. */
  loading?: boolean;
  /** The rows on screen are held over while others load (a new size, a search). */
  stale?: boolean;
  footer?: ReactNode;
}) {
  const columns = useMemo<WzReportColumn<UserContainerRow>[]>(() => {
    const cell: Record<string, (r: UserContainerRow) => ReactNode> = {
      name: (r) => (
        <span className="block truncate" title={r.email || undefined}>
          {r.name}
        </span>
      ),
      role: (r) => <span className="block truncate">{r.role ?? ""}</span>,
      location: (r) => (
        <LocationBox row={r} choices={choices} disabled={!canEdit || saving === r.userId} onAssign={onAssign} />
      ),
      restricted: (r) => {
        const a = r.assignment;
        const choice = locationChoice(a);
        const onVan = a.access === UserContainerAccess.CONTAINER;
        return (
          <WzWideSwitch
            label={`Restricted — ${r.name}`}
            checked={onVan && a.limited}
            // Restricted to one's own van: there is none with All or No access.
            disabled={!canEdit || !onVan || saving === r.userId}
            onCheckedChange={(limited) => onAssign(r.userId, assignmentBody(choice, limited, r.name))}
          />
        );
      },
      updated: (r) => (
        <span className="block truncate" title={r.assignment.row?.updatedByName || undefined}>
          {formatDate(r.assignment.updatedAt)}
        </span>
      ),
    };
    return USER_CONTAINER_COLUMNS.map((c) => ({ id: c.id, label: c.label, width: c.width, cell: cell[c.id] }));
  }, [choices, canEdit, saving, onAssign]);

  return (
    <WzReportGrid
      aria-label="User locations"
      className="shrink-0"
      rowHeight={INVENTORY_ROW_HEIGHTS["user-containers"]}
      columns={columns}
      rows={loading ? NO_ROWS : rows}
      rowKey={(r) => r.userId}
      sort={null}
      loading={loading}
      busy={stale}
      plainFiller
      emptyText={null}
      footer={footer}
    />
  );
}

/**
 * The row's Location box — react-select 159×38 in Workiz, saving the pick at
 * once. A van that is no longer active (or the legacy one the fleet names) is
 * shown as itself.
 */
function LocationBox({
  row,
  choices,
  disabled,
  onAssign,
}: {
  row: UserContainerRow;
  choices: { value: string; label: string }[];
  disabled: boolean;
  onAssign: (userId: string, body: AssignUserContainerBody) => void;
}) {
  const a = row.assignment;
  const value = locationChoice(a);
  const listed = !value || choices.some((c) => c.value === value);
  const options = listed ? choices : [...choices, { value, label: a.containerName ?? "Container" }];
  return (
    <Select
      value={value}
      disabled={disabled || row.pending}
      onValueChange={(next) => onAssign(row.userId, assignmentBody(next, a.limited, row.name))}
    >
      <SelectTrigger className="h-[38px] w-full" aria-label={`Location — ${row.name}`}>
        <SelectValue placeholder="Not set" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
            {a.legacy && o.value === value ? " (legacy)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
