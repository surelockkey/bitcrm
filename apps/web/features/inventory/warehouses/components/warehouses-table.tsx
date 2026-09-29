"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Pencil, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { usePermissions } from "@/features/auth/use-permissions";
import { cn } from "@/lib/utils";
import { useArchiveWarehouse, useWarehouseStockView } from "../hooks";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change.
 */
const COLUMNS: { id: string; label: string; width: number; className?: string }[] = [
  { id: "name", label: "Name", width: 260 },
  { id: "description", label: "Description", width: 340 },
  { id: "items", label: "Items", width: 120 },
  { id: "actions", label: "Actions", width: 140, className: "text-right" },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

/** Its own key: warehouses keep their widths apart from vans and items. */
const TABLE_KEY = "inventory-warehouses";

export function WarehousesTable({ warehouses }: { warehouses: Warehouse[] }) {
  const { widthOf, setWidth, reset } = useColumnWidths(TABLE_KEY, DEFAULT_WIDTHS);

  return (
    <div className="overflow-hidden border">
      {/* `table-fixed`: the column decides its width, not the longest
          description in the list — and the reader can drag the edge. */}
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
          {warehouses.map((w) => (
            <WarehouseRow key={w.id} warehouse={w} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function WarehouseRow({ warehouse: w }: { warehouse: Warehouse }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { summary, isLoading } = useWarehouseStockView(w.id);
  const archive = useArchiveWarehouse();
  const [confirm, setConfirm] = useState(false);
  const archived = w.status === InventoryStatus.ARCHIVED;

  return (
    <TableRow
      className={cn("cursor-pointer", archived && "opacity-55")}
      onClick={() => router.push(`/inventory/warehouses/${w.id}`)}
    >
      {/* Every cell clips: under fixed layout one that doesn't spills over
          the next column instead of widening its own. */}
      <TableCell className="overflow-hidden">
        <div className="truncate font-medium">{w.name}</div>
        {!isLoading && summary.lowCount > 0 ? (
          <Badge
            variant="outline"
            className="mt-1 gap-1 border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
          >
            Low stock
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="truncate text-sm text-muted-foreground">
        {w.description || w.address || "—"}
      </TableCell>
      <TableCell className="truncate tabular-nums">
        {isLoading ? (
          <Skeleton className="h-4 w-12" />
        ) : (
          summary.totalUnits.toLocaleString()
        )}
      </TableCell>
      <TableCell className="overflow-hidden text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-0.5">
          {can("warehouses", "edit") ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Edit"
              onClick={() => router.push(`/inventory/warehouses/${w.id}?tab=settings`)}
            >
              <Pencil />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="View stock"
            onClick={() => router.push(`/inventory/warehouses/${w.id}`)}
          >
            <Package />
          </Button>
          {!archived && can("warehouses", "delete") ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive"
              aria-label="Archive"
              onClick={() => setConfirm(true)}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>

        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive “{w.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Its stock history is kept, but it disappears from active lists
                and transfer targets.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => archive.mutate(w.id)}
              >
                Archive warehouse
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}
