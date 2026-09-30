"use client";

import { ClipboardCheck, Pencil } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import {
  INVENTORY_ROW,
  InventoryTable,
  type InventoryColumn,
} from "@/features/inventory/components/inventory-table";
import { templateUnits } from "../lib";
import { TemplateRowActions } from "./template-row-actions";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers. All left-aligned, counts included.
 */
export const TEMPLATE_COLUMNS: InventoryColumn[] = [
  { id: "name", label: "Name", width: 260 },
  { id: "description", label: "Description", width: 320 },
  { id: "items", label: "Items", width: 100 },
  { id: "units", label: "Units", width: 100 },
  { id: "usedBy", label: "Used by", width: 110 },
  { id: "actions", label: "Actions", width: 130 },
];

export const TEMPLATES_TABLE_KEY = "inventory-templates";

export function TemplatesTable({
  templates,
  usedBy,
  usedByPending = false,
  onEdit,
  onApply,
  loading = false,
  skeletonRows = 0,
}: {
  templates: ContainerTemplate[];
  /** Template id → how many vans name it. */
  usedBy: Map<string, number>;
  /** The vans are still loading: Used by waits rather than printing a 0 that changes. */
  usedByPending?: boolean;
  onEdit: (template: ContainerTemplate) => void;
  onApply: (template: ContainerTemplate) => void;
  /** First load: the same table, a page of skeleton rows. */
  loading?: boolean;
  skeletonRows?: number;
}) {
  return (
    <InventoryTable tableKey={TEMPLATES_TABLE_KEY} columns={TEMPLATE_COLUMNS} loading={loading} skeletonRows={skeletonRows}>
      {templates.map((t) => {
        const archived = t.status === InventoryStatus.ARCHIVED;
        return (
          <TableRow
            key={t.id}
            className={cn(INVENTORY_ROW, "cursor-pointer", archived && "opacity-55")}
            onClick={() => onEdit(t)}
          >
            {/* Every cell clips: under fixed layout one that doesn't spills into the next column. */}
            <TableCell className="overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{t.name}</span>
                {archived ? (
                  <Badge variant="outline" className="flex-none font-normal text-muted-foreground">
                    Archived
                  </Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="truncate text-muted-foreground" title={t.description || undefined}>
              {t.description || "—"}
            </TableCell>
            <TableCell className="truncate tabular-nums">{t.items.length}</TableCell>
            <TableCell className="truncate tabular-nums">{templateUnits(t).toLocaleString()}</TableCell>
            <TableCell className="truncate tabular-nums">
              {usedByPending ? (
                <Skeleton data-testid="used-by-pending" className="h-4 w-8" />
              ) : (
                (usedBy.get(t.id) ?? 0)
              )}
            </TableCell>
            {/* The popups these open sit over the row; their clicks must not reach it. */}
            <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-0.5">
                <RowIconAction label={`Edit ${t.name}`} tip="Edit" onClick={() => onEdit(t)}>
                  <Pencil />
                </RowIconAction>
                {!archived ? (
                  <RowIconAction label={`Apply ${t.name}`} tip="Apply to a van" onClick={() => onApply(t)}>
                    <ClipboardCheck />
                  </RowIconAction>
                ) : null}
                <TemplateRowActions template={t} />
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </InventoryTable>
  );
}
