"use client";

import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { useContainerStockView } from "../hooks";
import { containerTitle } from "../lib";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change.
 */
const COLUMNS: { id: string; label: string; width: number; className?: string }[] = [
  { id: "name", label: "Name", width: 260 },
  { id: "technician", label: "Technician", width: 220 },
  { id: "department", label: "Department", width: 180 },
  { id: "items", label: "Items", width: 120 },
  { id: "actions", label: "Actions", width: 120, className: "text-right" },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

/** The list's own key: the same name its page-size preference is saved under. */
const TABLE_KEY = "inventory-vans";

export function ContainersTable({ containers }: { containers: Container[] }) {
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
                className={c.className}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {containers.map((c) => (
            <ContainerRow key={c.id} container={c} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ContainerRow({ container: c }: { container: Container }) {
  const router = useRouter();
  const { summary, isLoading } = useContainerStockView(c.id);
  const inactive = c.status === InventoryStatus.ARCHIVED;

  return (
    <TableRow
      className={cn("cursor-pointer", inactive && "opacity-55")}
      onClick={() => router.push(`/inventory/containers/${c.id}`)}
    >
      {/* Every cell clips: under fixed layout one that doesn't spills over
          the next column instead of widening its own. */}
      <TableCell className="overflow-hidden">
        <div className="truncate font-medium">{containerTitle(c)}</div>
        {!isLoading && summary.lowCount > 0 ? (
          <Badge
            variant="outline"
            className="mt-1 gap-1 border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
          >
            Low stock
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="truncate text-sm">
        {c.technicianName ? (
          c.technicianName
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </TableCell>
      <TableCell className="truncate text-sm text-muted-foreground">
        {c.department || "—"}
      </TableCell>
      <TableCell className="truncate tabular-nums">
        {isLoading ? (
          <Skeleton className="h-4 w-12" />
        ) : (
          summary.totalUnits.toLocaleString()
        )}
      </TableCell>
      <TableCell
        className="overflow-hidden text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="View stock"
            onClick={() => router.push(`/inventory/containers/${c.id}`)}
          >
            <Package />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
