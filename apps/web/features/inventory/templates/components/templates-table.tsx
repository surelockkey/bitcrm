"use client";

import { useMemo, type ReactNode } from "react";
import { ClipboardCheck } from "lucide-react";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate } from "@bitcrm/types";
import { WzEditIcon } from "@/components/workiz/icons";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { LocationName } from "@/features/inventory/components/locations-grid";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { templateUnits } from "../lib";
import { TemplateRowActions } from "./template-row-actions";

/**
 * A van's ideal loadouts — BitCRM's own (Workiz has no templates), drawn as
 * Workiz's Locations grid: Name 200 · Description · Items · Units · Used by
 * · Actions 150 (edit, apply to a van, archive / restore).
 */
export const TEMPLATE_COLUMNS: { id: string; label: string; width?: number }[] = [
  { id: "name", label: "Name", width: 200 },
  { id: "description", label: "Description" },
  { id: "items", label: "Items" },
  { id: "units", label: "Units" },
  { id: "usedBy", label: "Used by" },
  { id: "actions", label: "Actions", width: 150 },
];

export const TEMPLATES_TABLE_KEY = "inventory-templates";

const FLEX = 260;
const WIDTHS = Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c.id, c.width ?? FLEX]));
const NO_ROWS: ContainerTemplate[] = [];

export function TemplatesTable({
  templates,
  usedBy,
  onEdit,
  onApply,
  loading = false,
  stale = false,
  footer,
}: {
  templates: ContainerTemplate[];
  /** Template id → how many vans name it. */
  usedBy: Map<string, number>;
  onEdit: (template: ContainerTemplate) => void;
  onApply: (template: ContainerTemplate) => void;
  /** First load: the header and Workiz's loader. */
  loading?: boolean;
  /** Another status's rows, held (dimmed) while its own load. */
  stale?: boolean;
  footer?: ReactNode;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths(`${TEMPLATES_TABLE_KEY}-wz`, WIDTHS);
  const columns = useMemo<WzReportColumn<ContainerTemplate>[]>(() => {
    const cell: Record<string, (t: ContainerTemplate) => ReactNode> = {
      name: (t) => <LocationName name={t.name} archived={t.status === InventoryStatus.ARCHIVED} />,
      description: (t) => (
        <span className="block truncate" title={t.description || undefined}>
          {t.description ?? ""}
        </span>
      ),
      items: (t) => t.items.length,
      units: (t) => templateUnits(t).toLocaleString(),
      usedBy: (t) => usedBy.get(t.id) ?? 0,
      actions: (t) => (
        // The popups these open sit over the row; their clicks must not reach it.
        <div className="flex items-center gap-[15px]" onClick={(e) => e.stopPropagation()}>
          <RowIconAction label={`Edit ${t.name}`} tip="Edit" onClick={() => onEdit(t)}>
            <WzEditIcon />
          </RowIconAction>
          {t.status !== InventoryStatus.ARCHIVED ? (
            <RowIconAction label={`Apply ${t.name}`} tip="Apply to a van" onClick={() => onApply(t)}>
              <ClipboardCheck className="size-6" strokeWidth={1.5} />
            </RowIconAction>
          ) : null}
          <TemplateRowActions template={t} />
        </div>
      ),
    };
    return TEMPLATE_COLUMNS.map((c) => ({ id: c.id, label: c.label, cell: cell[c.id] }));
  }, [usedBy, onEdit, onApply]);

  return (
    <WzReportGrid
      aria-label="Templates"
      className="shrink-0"
      columns={columns}
      rows={loading ? NO_ROWS : templates}
      rowKey={(t) => t.id}
      sort={null}
      resize={{ widthOf, setWidth, reset }}
      onRowClick={(t) => onEdit(t)}
      loading={loading}
      busy={stale}
      plainFiller
      footer={footer}
    />
  );
}
