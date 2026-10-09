"use client";

import { useMemo, type ReactNode } from "react";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { LocationActions, LocationName } from "@/features/inventory/components/locations-grid";
import { INVENTORY_ROW_HEIGHTS } from "@/features/inventory/row-heights";
import { formatTotal, type LocationTotals } from "@/features/inventory/stock/lib";
import { namesSummary, type ContainerUser } from "@/features/inventory/user-containers/lib";
import { containerTitle } from "../lib";

/**
 * Workiz's Locations grid for the vans (pg_inventory_wz_02_locations): Name
 * 200 · Description · Items · Actions 150, with BitCRM's own columns where
 * they belong — who works from the van and its department after the
 * description, the SKUs after Items.
 */
export const CONTAINER_COLUMNS: { id: string; label: string; width?: number }[] = [
  { id: "name", label: "Name", width: 200 },
  { id: "description", label: "Description" },
  { id: "users", label: "Users" },
  { id: "department", label: "Department" },
  { id: "items", label: "Items" },
  { id: "skus", label: "SKUs" },
  { id: "actions", label: "Actions", width: 150 },
];

/** The list's own key: the same name its page-size preference is saved under. */
export const CONTAINERS_TABLE_KEY = "inventory-vans";

/** A flexible column's start, when the reader drags one: its share of a 1400px frame. */
const FLEX = 210;
const WIDTHS = Object.fromEntries(CONTAINER_COLUMNS.map((c) => [c.id, c.width ?? FLEX]));
const NO_ROWS: Container[] = [];

export function ContainersTable({
  containers,
  users,
  onEdit,
  onStock,
  loading = false,
  stale = false,
  footer,
}: {
  containers: Container[];
  /** Who works from each van — a van may be shared. */
  users: Map<string, ContainerUser[]>;
  onEdit: (container: Container) => void;
  onStock: (container: Container) => void;
  /** First load: the header and Workiz's loader. */
  loading?: boolean;
  /** The previous filter's rows, dimmed, while the new ones load. */
  stale?: boolean;
  footer?: ReactNode;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths(`${CONTAINERS_TABLE_KEY}-wz`, WIDTHS);
  const columns = useMemo<WzReportColumn<Container & LocationTotals>[]>(() => {
    const cell: Record<string, (c: Container & LocationTotals) => ReactNode> = {
      name: (c) => <LocationName name={containerTitle(c)} archived={c.status === InventoryStatus.ARCHIVED} />,
      description: (c) => (
        <span className="block truncate" title={c.description || undefined}>
          {c.description ?? ""}
        </span>
      ),
      users: (c) => <UsersCell users={users.get(c.id) ?? []} />,
      department: (c) => <span className="block truncate">{c.department ?? ""}</span>,
      // The server keeps both on the row — no request per van to count them.
      items: (c) => formatTotal(c.totalUnits),
      skus: (c) => formatTotal(c.uniqueItems),
      actions: (c) => (
        <LocationActions name={containerTitle(c)} onEdit={() => onEdit(c)} onStock={() => onStock(c)} />
      ),
    };
    return CONTAINER_COLUMNS.map((col) => ({ id: col.id, label: col.label, cell: cell[col.id] }));
  }, [users, onEdit, onStock]);

  return (
    <WzReportGrid
      aria-label="Containers"
      className="shrink-0"
      rowHeight={INVENTORY_ROW_HEIGHTS.containers}
      columns={columns}
      rows={loading ? NO_ROWS : containers}
      rowKey={(c) => c.id}
      sort={null}
      resize={{ widthOf, setWidth, reset }}
      // A row opens the van's stock, as the box does.
      onRowClick={(c) => onStock(c)}
      loading={loading}
      busy={stale}
      plainFiller
      // Workiz's Locations: an empty search leaves the blank rows, nothing written over them.
      emptyText={null}
      footer={footer}
    />
  );
}

/** The first two names and "+N" for the rest — someone not named yet counts in the N. */
function UsersCell({ users }: { users: ContainerUser[] }) {
  if (users.length === 0) return null;
  const named = users.map((u) => u.name).filter((n): n is string => !!n);
  const { text, more } = namesSummary(named);
  const rest = more + (users.length - named.length);
  return (
    <span className="block truncate" title={named.join(", ") || undefined}>
      {text}
      {rest > 0 ? <span className="text-wz-outline-label">{text ? " " : ""}+{rest}</span> : null}
    </span>
  );
}
