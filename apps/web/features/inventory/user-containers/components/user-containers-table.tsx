"use client";

import { Truck } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { UserContainerAccess } from "@bitcrm/types";
import { formatDate } from "@/features/users/lib";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { InventoryTable, type InventoryColumn } from "@/features/inventory/components/inventory-table";
import { accessLabel, type Assignment } from "../lib";

/** One user and what they work from. */
export interface UserContainerRow {
  userId: string;
  name: string;
  email?: string;
  assignment: Assignment;
  /**
   * No assignment row, and the fleet that may hold their legacy van is still
   * loading: the row waits rather than reading "Not set" and changing.
   */
  pending?: boolean;
}

/** Two lines in the User cell (name, email): taller than an inventory row — its skeleton too. */
const USER_ROW = "h-[3.25rem]";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers. All left-aligned, as Workiz lays its grids out.
 */
export const USER_CONTAINER_COLUMNS: InventoryColumn[] = [
  { id: "user", label: "User", width: 260 },
  { id: "container", label: "Container", width: 240 },
  { id: "access", label: "Access", width: 150 },
  { id: "limited", label: "Limited", width: 100 },
  { id: "updated", label: "Updated", width: 140 },
  { id: "actions", label: "Actions", width: 90 },
];

export const USER_CONTAINERS_TABLE_KEY = "inventory-user-containers";

export function UserContainersTable({
  rows,
  onAssign,
  loading = false,
  skeletonRows = 0,
  stale = false,
}: {
  rows: UserContainerRow[];
  onAssign: (userId: string) => void;
  /** First load: the same table, a page of skeleton rows. */
  loading?: boolean;
  skeletonRows?: number;
  /** The rows on screen are held over while others load (a new size, a search). */
  stale?: boolean;
}) {
  return (
    <InventoryTable
      tableKey={USER_CONTAINERS_TABLE_KEY}
      columns={USER_CONTAINER_COLUMNS}
      loading={loading}
      skeletonRows={skeletonRows}
      stale={stale}
      rowClassName={USER_ROW}
    >
      {rows.map((r) => (
        <Row key={r.userId} row={r} onAssign={onAssign} />
      ))}
    </InventoryTable>
  );
}

/* Every cell clips: under fixed layout one that doesn't spills into the next column. */
function Row({ row: r, onAssign }: { row: UserContainerRow; onAssign: (userId: string) => void }) {
  const a = r.assignment;
  const withContainer = a.access === UserContainerAccess.CONTAINER;
  return (
    <TableRow data-user={r.userId} className={`${USER_ROW} cursor-pointer`} onClick={() => onAssign(r.userId)}>
      <TableCell className="overflow-hidden">
        <div className="truncate font-medium">{r.name}</div>
        {r.email ? <div className="truncate text-xs text-muted-foreground">{r.email}</div> : null}
      </TableCell>
      <TableCell className="overflow-hidden">
        {r.pending ? (
          <Skeleton data-testid="assignment-pending" className="h-4 w-28" />
        ) : withContainer && a.containerName ? (
          <div className="flex items-center gap-2">
            <span className="truncate">{a.containerName}</span>
            {a.legacy ? (
              <span
                className="flex-none text-[11px] text-muted-foreground"
                title="No assignment saved yet: this van names them as its technician."
              >
                legacy
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className={a.access ? "truncate" : "truncate text-muted-foreground"}>
        {r.pending ? <Skeleton className="h-4 w-16" /> : accessLabel(a.access)}
      </TableCell>
      <TableCell className="truncate text-muted-foreground">
        {r.pending ? <Skeleton className="h-4 w-8" /> : withContainer && !a.legacy ? (a.limited ? "Yes" : "No") : "—"}
      </TableCell>
      <TableCell className="truncate text-sm text-muted-foreground" title={a.row?.updatedByName || undefined}>
        {formatDate(a.updatedAt)}
      </TableCell>
      {/* The popup it opens sits over the row; its clicks must not reach it. */}
      <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <RowIconAction label={`Assign a container to ${r.name}`} tip="Assign" onClick={() => onAssign(r.userId)}>
          <Truck />
        </RowIconAction>
      </TableCell>
    </TableRow>
  );
}
