"use client";

import { useMemo, type ReactNode } from "react";
import type { Transfer } from "@bitcrm/types";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { INVENTORY_ROW_HEIGHTS } from "@/features/inventory/row-heights";
import { formatDate } from "@/features/users/lib";
import { TransferTypeBadge } from "./transfer-type-badge";
import { TransferRoute } from "./transfer-route";

/**
 * The movement journal — BitCRM's own (Workiz shows no transfer list), drawn
 * as Workiz's Locations grid: Type · Route · Items · By · When.
 */
export const TRANSFER_COLUMNS: { id: string; label: string; width?: number }[] = [
  { id: "type", label: "Type", width: 160 },
  { id: "route", label: "Route" },
  { id: "items", label: "Items" },
  { id: "by", label: "By", width: 200 },
  { id: "when", label: "When", width: 150 },
];

/** The list's own key: the same name its page-size preference is saved under. */
export const TRANSFERS_TABLE_KEY = "inventory-transfers";

const FLEX = 400;
const WIDTHS = Object.fromEntries(TRANSFER_COLUMNS.map((c) => [c.id, c.width ?? FLEX]));
const NO_ROWS: Transfer[] = [];

function itemsSummary(t: Transfer): { text: string; more: number } {
  const shown = t.items.slice(0, 2).map((i) => `${i.productName} ×${i.quantity}`);
  return { text: shown.join(", "), more: Math.max(0, t.items.length - 2) };
}

/** The movement journal, a page at a time; a row opens its record. */
export function TransfersTable({
  transfers,
  locationMap,
  namesPending = false,
  onOpen,
  loading = false,
  stale = false,
  footer,
}: {
  transfers: Transfer[];
  locationMap: Map<string, string>;
  /** The location names are still loading — the routes wait for them. */
  namesPending?: boolean;
  onOpen: (transfer: Transfer) => void;
  loading?: boolean;
  stale?: boolean;
  footer?: ReactNode;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths(`${TRANSFERS_TABLE_KEY}-wz`, WIDTHS);
  const columns = useMemo<WzReportColumn<Transfer>[]>(() => {
    const cell: Record<string, (t: Transfer) => ReactNode> = {
      type: (t) => <TransferTypeBadge type={t.type} />,
      route: (t) => <TransferRoute transfer={t} locationMap={locationMap} pending={namesPending} />,
      items: (t) => {
        const { text, more } = itemsSummary(t);
        return (
          <span className="block truncate">
            {text}
            {more > 0 ? <span className="text-wz-outline-label"> +{more}</span> : null}
          </span>
        );
      },
      by: (t) => <span className="block truncate">{t.performedByName}</span>,
      when: (t) => formatDate(t.createdAt),
    };
    return TRANSFER_COLUMNS.map((c) => ({ id: c.id, label: c.label, cell: cell[c.id] }));
  }, [locationMap, namesPending]);

  return (
    <WzReportGrid
      aria-label="Transfers"
      className="shrink-0"
      rowHeight={INVENTORY_ROW_HEIGHTS.transfers}
      columns={columns}
      rows={loading ? NO_ROWS : transfers}
      rowKey={(t) => t.id}
      sort={null}
      resize={{ widthOf, setWidth, reset }}
      onRowClick={(t) => onOpen(t)}
      loading={loading}
      busy={stale}
      plainFiller
      footer={footer}
    />
  );
}
