"use client";

import { ClipboardCheck, Pencil } from "lucide-react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { TableFrame } from "@/features/inventory/components/table-frame";
import { templateUnits } from "../lib";
import { TemplateRowActions } from "./template-row-actions";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers. All left-aligned, counts included.
 */
const COLUMNS: { id: string; label: string; width: number }[] = [
  { id: "name", label: "Name", width: 260 },
  { id: "description", label: "Description", width: 320 },
  { id: "items", label: "Items", width: 100 },
  { id: "units", label: "Units", width: 100 },
  { id: "usedBy", label: "Used by", width: 110 },
  { id: "actions", label: "Actions", width: 130 },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

const TABLE_KEY = "inventory-templates";

export function TemplatesTable({
  templates,
  usedBy,
  onEdit,
  onApply,
}: {
  templates: ContainerTemplate[];
  /** Template id → how many vans name it. */
  usedBy: Map<string, number>;
  onEdit: (template: ContainerTemplate) => void;
  onApply: (template: ContainerTemplate) => void;
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
          {templates.map((t) => {
            const archived = t.status === InventoryStatus.ARCHIVED;
            return (
              <TableRow
                key={t.id}
                className={cn("cursor-pointer", archived && "opacity-55")}
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
                <TableCell className="truncate tabular-nums">{usedBy.get(t.id) ?? 0}</TableCell>
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
        </TableBody>
      </Table>
    </TableFrame>
  );
}
