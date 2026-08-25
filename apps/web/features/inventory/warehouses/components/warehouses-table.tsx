"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Pencil, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
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
import { usePermissions } from "@/features/auth/use-permissions";
import { cn } from "@/lib/utils";
import { useArchiveWarehouse, useWarehouseStockView } from "../hooks";

export function WarehousesTable({ warehouses }: { warehouses: Warehouse[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Items</TableHead>
            <TableHead className="w-32 text-right">Actions</TableHead>
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
      <TableCell>
        <div className="font-medium">{w.name}</div>
        {!isLoading && summary.lowCount > 0 ? (
          <Badge
            variant="outline"
            className="mt-1 gap-1 border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
          >
            Low stock
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="max-w-[340px] truncate text-sm text-muted-foreground">
        {w.description || w.address || "—"}
      </TableCell>
      <TableCell className="tabular-nums">
        {isLoading ? (
          <Skeleton className="h-4 w-12" />
        ) : (
          summary.totalUnits.toLocaleString()
        )}
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
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
