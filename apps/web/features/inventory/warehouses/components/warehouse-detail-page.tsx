"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Info, Upload } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryStatus } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useWarehouse, useWarehouseStock, useArchiveWarehouse } from "../hooks";
import { WarehouseStockTab } from "./warehouse-stock-tab";
import { WarehouseActivityTab } from "./warehouse-activity-tab";
import { WarehouseSettingsTab } from "./warehouse-settings-tab";
import { ReceiveStockDialog } from "./receive-stock-dialog";
import {
  TransferStockDialog,
  type TransferTarget,
} from "./transfer-stock-dialog";

export function WarehouseDetailPage({ warehouseId }: { warehouseId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const query = useWarehouse(warehouseId);
  const stockQuery = useWarehouseStock(warehouseId);
  const archive = useArchiveWarehouse();

  const [tab, setTab] = useState("stock");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const inStock = useMemo(
    () => (stockQuery.data ?? []).filter((s) => s.quantity > 0),
    [stockQuery.data],
  );
  const heldUnits = inStock.reduce((n, s) => n + s.quantity, 0);

  const canEdit = can("warehouses", "edit");
  const canArchive = can("warehouses", "delete");

  if (!can("warehouses", "view")) {
    return <Center title="No access" body="You don't have permission to view warehouses." />;
  }
  if (query.isLoading) return <DetailSkeleton />;
  if (query.isError || !query.data) {
    return (
      <Center
        title="Warehouse not found"
        body="It may have been deleted."
        action={
          <Button variant="outline" onClick={() => router.push("/inventory/warehouses")}>
            Back to warehouses
          </Button>
        }
      />
    );
  }

  const warehouse = query.data;
  const archived = warehouse.status === InventoryStatus.ARCHIVED;

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => router.push("/inventory/warehouses")}
        >
          <ArrowLeft className="size-4" />
          Warehouses
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{warehouse.name}</h1>
          {warehouse.address ? (
            <div className="truncate text-xs text-muted-foreground">{warehouse.address}</div>
          ) : null}
        </div>
        <Badge
          variant="outline"
          className={cn("gap-1.5 font-normal", archived ? "text-muted-foreground" : "text-foreground")}
        >
          <span className={cn("size-1.5 rounded-full", archived ? "bg-muted-foreground/50" : "bg-green-500")} />
          {archived ? "Archived" : "Active"}
        </Badge>
        {!archived && canEdit ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setReceiveOpen(true)}>
            <Upload className="size-3.5" />
            Receive stock
          </Button>
        ) : null}
        {!archived && canArchive ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Archive warehouse"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmArchive(true)}
          >
            <Archive className="size-4" />
          </Button>
        ) : null}
      </div>

      {!canEdit ? (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-6 py-2 text-sm text-muted-foreground">
          <Info className="size-4" />
          You have view-only access to warehouses.
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <div className="border-b px-6">
          <div className="mx-auto max-w-5xl">
            <TabsList variant="line" className="h-11">
              <TabsTrigger value="stock" className="px-2">
                Stock{inStock.length ? ` · ${inStock.length}` : ""}
              </TabsTrigger>
              <TabsTrigger value="activity" className="px-2">Activity</TabsTrigger>
              <TabsTrigger value="settings" className="px-2">Settings</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-6">
            <TabsContent value="stock" className="mt-0">
              <WarehouseStockTab warehouseId={warehouseId} onTransfer={setTransferTarget} />
            </TabsContent>
            <TabsContent value="activity" className="mt-0">
              <WarehouseActivityTab warehouseId={warehouseId} />
            </TabsContent>
            <TabsContent value="settings" className="mt-0">
              <WarehouseSettingsTab key={warehouse.updatedAt} warehouse={warehouse} readOnly={!canEdit} />
            </TabsContent>
          </div>
        </div>
      </Tabs>

      <ReceiveStockDialog
        warehouseId={warehouseId}
        warehouseName={warehouse.name}
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
      />
      <TransferStockDialog
        warehouseId={warehouseId}
        item={transferTarget}
        open={transferTarget !== null}
        onOpenChange={(o) => !o && setTransferTarget(null)}
      />

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{warehouse.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It&apos;s hidden from active lists. Archiving doesn&apos;t move its stock.
              {heldUnits > 0 ? (
                <>
                  {" "}
                  This warehouse still holds <b>{heldUnits.toLocaleString()} units</b> — transfer
                  them out first if you don&apos;t want them stranded.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                archive.mutate(warehouse.id, {
                  onSuccess: () => router.push("/inventory/warehouses"),
                })
              }
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Center({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
