"use client";

import { Boxes, Pencil } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import {
  INVENTORY_ROW,
  InventoryTable,
  type InventoryColumn,
} from "@/features/inventory/components/inventory-table";
import { formatTotal, type LocationTotals } from "@/features/inventory/stock/lib";
import { containerTitle } from "../lib";
import { namesSummary, type ContainerUser } from "@/features/inventory/user-containers/lib";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change. All
 * left-aligned, counts included, as Workiz lays its grids out.
 */
export const CONTAINER_COLUMNS: InventoryColumn[] = [
  { id: "name", label: "Name", width: 240 },
  { id: "description", label: "Description", width: 240 },
  { id: "users", label: "Users", width: 220 },
  { id: "department", label: "Department", width: 160 },
  { id: "items", label: "Items", width: 110 },
  { id: "skus", label: "SKUs", width: 90 },
  { id: "actions", label: "Actions", width: 100 },
];

/** The list's own key: the same name its page-size preference is saved under. */
export const CONTAINERS_TABLE_KEY = "inventory-vans";

export function ContainersTable({
  containers,
  users,
  onEdit,
  onStock,
  loading = false,
  skeletonRows = 0,
  stale = false,
}: {
  containers: Container[];
  /** Who works from each van — a van may be shared. */
  users: Map<string, ContainerUser[]>;
  onEdit: (container: Container) => void;
  onStock: (container: Container) => void;
  /** First load: the same table, a page of skeleton rows. */
  loading?: boolean;
  skeletonRows?: number;
  /** The previous filter's rows, held while the new ones load. */
  stale?: boolean;
}) {
  return (
    <InventoryTable
      tableKey={CONTAINERS_TABLE_KEY}
      columns={CONTAINER_COLUMNS}
      loading={loading}
      skeletonRows={skeletonRows}
      stale={stale}
    >
      {containers.map((c) => (
        <ContainerRow key={c.id} container={c} users={users.get(c.id) ?? []} onEdit={onEdit} onStock={onStock} />
      ))}
    </InventoryTable>
  );
}

function ContainerRow({
  container: c,
  users,
  onEdit,
  onStock,
}: {
  container: Container & LocationTotals;
  users: ContainerUser[];
  onEdit: (container: Container) => void;
  onStock: (container: Container) => void;
}) {
  const inactive = c.status === InventoryStatus.ARCHIVED;
  const title = containerTitle(c);

  return (
    <TableRow className={cn(INVENTORY_ROW, "cursor-pointer", inactive && "opacity-55")} onClick={() => onStock(c)}>
      {/* Every cell clips: under fixed layout one that doesn't spills over
          the next column instead of widening its own. */}
      <TableCell className="truncate font-medium">{title}</TableCell>
      <TableCell className="truncate text-sm text-muted-foreground" title={c.description || undefined}>
        {c.description || "—"}
      </TableCell>
      <UsersCell users={users} />
      <TableCell className="truncate text-sm text-muted-foreground">{c.department || "—"}</TableCell>
      {/* The server keeps both on the row — no request per van to count them. */}
      <TableCell className="truncate tabular-nums">{formatTotal(c.totalUnits)}</TableCell>
      <TableCell className="truncate tabular-nums">{formatTotal(c.uniqueItems)}</TableCell>
      {/* The popups these open sit over the row; their clicks must not reach it. */}
      <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          <RowIconAction label={`Edit ${title}`} tip="Edit" onClick={() => onEdit(c)}>
            <Pencil />
          </RowIconAction>
          <RowIconAction label={`Stock in ${title}`} tip="Stock" onClick={() => onStock(c)}>
            <Boxes />
          </RowIconAction>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** The first two names and "+N" for the rest — someone not named yet counts in the N. */
function UsersCell({ users }: { users: ContainerUser[] }) {
  if (users.length === 0) {
    return <TableCell className="truncate text-sm text-muted-foreground">—</TableCell>;
  }
  const named = users.map((u) => u.name).filter((n): n is string => !!n);
  const { text, more } = namesSummary(named);
  const rest = more + (users.length - named.length);
  return (
    <TableCell className="truncate text-sm" title={named.join(", ") || undefined}>
      {text}
      {rest > 0 ? <span className="text-muted-foreground">{text ? " " : ""}+{rest}</span> : null}
    </TableCell>
  );
}
