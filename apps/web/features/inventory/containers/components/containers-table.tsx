"use client";

import { Boxes, Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { useContainerStockView } from "../hooks";
import { containerTitle } from "../lib";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change. All
 * left-aligned, counts included, as Workiz lays its grids out.
 */
const COLUMNS: { id: string; label: string; width: number }[] = [
  { id: "name", label: "Name", width: 240 },
  { id: "description", label: "Description", width: 240 },
  { id: "technician", label: "Technician", width: 200 },
  { id: "department", label: "Department", width: 160 },
  { id: "items", label: "Items", width: 110 },
  { id: "actions", label: "Actions", width: 100 },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

/** The list's own key: the same name its page-size preference is saved under. */
const TABLE_KEY = "inventory-vans";

export function ContainersTable({
  containers,
  onEdit,
  onStock,
}: {
  containers: Container[];
  onEdit: (container: Container) => void;
  onStock: (container: Container) => void;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths(TABLE_KEY, DEFAULT_WIDTHS);

  return (
    <div className="overflow-hidden border">
      {/* `table-fixed`: the column decides its width, not the longest van
          name in the list — and the reader can drag the edge. */}
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
          {containers.map((c) => (
            <ContainerRow key={c.id} container={c} onEdit={onEdit} onStock={onStock} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ContainerRow({
  container: c,
  onEdit,
  onStock,
}: {
  container: Container;
  onEdit: (container: Container) => void;
  onStock: (container: Container) => void;
}) {
  // One stock read per row shown: the list carries no totals, and only the
  // current page is rendered, so this never fans out across the fleet.
  const { summary, isLoading } = useContainerStockView(c.id);
  const inactive = c.status === InventoryStatus.ARCHIVED;
  const title = containerTitle(c);

  return (
    <TableRow className={cn("cursor-pointer", inactive && "opacity-55")} onClick={() => onStock(c)}>
      {/* Every cell clips: under fixed layout one that doesn't spills over
          the next column instead of widening its own. */}
      <TableCell className="overflow-hidden">
        <div className="truncate font-medium">{title}</div>
        {!isLoading && summary.lowCount > 0 ? (
          <Badge
            variant="outline"
            className="mt-1 gap-1 border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
          >
            Low stock
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="truncate text-sm text-muted-foreground" title={c.description || undefined}>
        {c.description || "—"}
      </TableCell>
      <TableCell className="truncate text-sm">
        {c.technicianName ? c.technicianName : <span className="text-muted-foreground">Unassigned</span>}
      </TableCell>
      <TableCell className="truncate text-sm text-muted-foreground">{c.department || "—"}</TableCell>
      <TableCell className="truncate tabular-nums">
        {isLoading ? <Skeleton className="h-4 w-12" /> : summary.totalUnits.toLocaleString()}
      </TableCell>
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
