"use client";

import { Truck } from "lucide-react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { UserContainerAccess } from "@bitcrm/types";
import { formatDate } from "@/features/users/lib";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { TableFrame } from "@/features/inventory/components/table-frame";
import { accessLabel, type Assignment } from "../lib";

/** One user and what they work from. */
export interface UserContainerRow {
  userId: string;
  name: string;
  email?: string;
  assignment: Assignment;
}

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers. All left-aligned, as Workiz lays its grids out.
 */
const COLUMNS: { id: string; label: string; width: number }[] = [
  { id: "user", label: "User", width: 260 },
  { id: "container", label: "Container", width: 240 },
  { id: "access", label: "Access", width: 150 },
  { id: "limited", label: "Limited", width: 100 },
  { id: "updated", label: "Updated", width: 140 },
  { id: "actions", label: "Actions", width: 90 },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

const TABLE_KEY = "inventory-user-containers";

export function UserContainersTable({
  rows,
  onAssign,
}: {
  rows: UserContainerRow[];
  onAssign: (userId: string) => void;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths(TABLE_KEY, DEFAULT_WIDTHS);

  return (
    <TableFrame>
      <Table className="table-fixed">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <ResizableHead
                key={c.id}
                columnId={c.id}
                label={c.label}
                width={widthOf(c.id)}
                onResize={(px) => setWidth(c.id, px)}
                onReset={reset}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <Row key={r.userId} row={r} onAssign={onAssign} />
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

/* Every cell clips: under fixed layout one that doesn't spills into the next column. */
function Row({ row: r, onAssign }: { row: UserContainerRow; onAssign: (userId: string) => void }) {
  const a = r.assignment;
  const withContainer = a.access === UserContainerAccess.CONTAINER;
  return (
    <TableRow data-user={r.userId} className="cursor-pointer" onClick={() => onAssign(r.userId)}>
      <TableCell className="overflow-hidden">
        <div className="truncate font-medium">{r.name}</div>
        {r.email ? <div className="truncate text-xs text-muted-foreground">{r.email}</div> : null}
      </TableCell>
      <TableCell className="overflow-hidden">
        {withContainer && a.containerName ? (
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
        {accessLabel(a.access)}
      </TableCell>
      <TableCell className="truncate text-muted-foreground">
        {withContainer && !a.legacy ? (a.limited ? "Yes" : "No") : "—"}
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
