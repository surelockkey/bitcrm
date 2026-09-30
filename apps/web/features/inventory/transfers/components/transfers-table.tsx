"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import type { Transfer } from "@bitcrm/types";
import { formatDate } from "@/features/users/lib";
import {
  INVENTORY_ROW,
  InventoryTable,
  type InventoryColumn,
} from "@/features/inventory/components/inventory-table";
import { TransferTypeBadge } from "./transfer-type-badge";
import { TransferRoute } from "./transfer-route";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change.
 */
const COLUMNS: InventoryColumn[] = [
  { id: "type", label: "Type", width: 120 },
  { id: "route", label: "Route", width: 280 },
  { id: "items", label: "Items", width: 240 },
  { id: "by", label: "By", width: 160 },
  { id: "when", label: "When", width: 150 },
];

/** The list's own key: the same name its page-size preference is saved under. */
export const TRANSFERS_TABLE_KEY = "inventory-transfers";

function itemsSummary(t: Transfer): { text: string; more: number } {
  const shown = t.items.slice(0, 2).map((i) => `${i.productName} ×${i.quantity}`);
  return { text: shown.join(", "), more: Math.max(0, t.items.length - 2) };
}

/** The movement journal, a page at a time. */
export function TransfersTable({
  transfers,
  locationMap,
  namesPending = false,
  onOpen,
  loading = false,
  skeletonRows = 0,
  stale = false,
}: {
  transfers: Transfer[];
  locationMap: Map<string, string>;
  /** The location names are still loading — the routes wait for them. */
  namesPending?: boolean;
  onOpen: (transfer: Transfer) => void;
  loading?: boolean;
  skeletonRows?: number;
  stale?: boolean;
}) {
  return (
    <InventoryTable
      tableKey={TRANSFERS_TABLE_KEY}
      columns={COLUMNS}
      loading={loading}
      skeletonRows={skeletonRows}
      stale={stale}
    >
      {transfers.map((t) => {
        const { text, more } = itemsSummary(t);
        return (
          <TableRow key={t.id} className={`${INVENTORY_ROW} cursor-pointer`} onClick={() => onOpen(t)}>
            {/* Every cell clips: under fixed layout one that doesn't spills
                over the next column instead of widening its own. */}
            <TableCell className="overflow-hidden">
              <TransferTypeBadge type={t.type} />
            </TableCell>
            <TableCell className="overflow-hidden">
              <TransferRoute transfer={t} locationMap={locationMap} pending={namesPending} />
            </TableCell>
            <TableCell className="truncate text-sm">
              {text}
              {more > 0 ? <span className="text-muted-foreground"> +{more}</span> : null}
            </TableCell>
            <TableCell className="truncate text-sm text-muted-foreground">{t.performedByName}</TableCell>
            <TableCell className="truncate text-sm text-muted-foreground">{formatDate(t.createdAt)}</TableCell>
          </TableRow>
        );
      })}
    </InventoryTable>
  );
}
