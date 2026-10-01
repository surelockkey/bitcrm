"use client";

import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Info, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogLoadingBody } from "@/features/inventory/components/dialog-loading";
import type { LocationTotals } from "@/features/inventory/stock/lib";
import { Textarea } from "@/components/ui/textarea";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  useArchiveWarehouse,
  useUpdateWarehouse,
  useWarehouse,
  useWarehouseStock,
} from "../hooks";
import { warehouseSchema, type WarehouseValues } from "../schemas";

/** The footer's Save sits outside the scrolling body and submits by this id. */
const FORM_ID = "warehouse-edit-form";

/**
 * The warehouse's Edit popup — Inventory has no warehouse page any more.
 * Opened from the row's pencil or a link to the warehouse; view-only without
 * `warehouses.edit`. Archive sits in its footer, as on an item's popup.
 */
export function WarehouseEditDialog({
  warehouseId,
  open,
  onOpenChange,
}: {
  warehouseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = usePermissions();
  const query = useWarehouse(warehouseId, open);
  const canEdit = can("warehouses", "edit");
  const close = () => onOpenChange(false);

  let content: ReactNode;
  if (query.isLoading) {
    content = (
      <>
        <Header title={canEdit ? "Edit warehouse" : "Warehouse"} />
        <DialogLoadingBody testId="warehouse-edit-loading" fields={["input", "input", "area"]} />
      </>
    );
  } else if (query.isError || !query.data) {
    content = (
      <>
        <Header title="Warehouse not found" description="It may have been deleted." />
        <DialogFooter className="m-0 flex-none">
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  } else {
    // Keyed by the save time: a fresh copy of the warehouse starts a fresh form.
    content = (
      <WarehouseForm
        key={query.data.updatedAt}
        warehouse={query.data}
        readOnly={!canEdit}
        canArchive={can("warehouses", "delete")}
        onClose={close}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        {content}
      </DialogContent>
    </Dialog>
  );
}

function WarehouseForm({
  warehouse,
  readOnly,
  canArchive,
  onClose,
}: {
  warehouse: Warehouse;
  readOnly: boolean;
  canArchive: boolean;
  onClose: () => void;
}) {
  const update = useUpdateWarehouse();
  const archive = useArchiveWarehouse();
  // The row keeps its units on it; only a warehouse the backfill has not
  // reached yet is counted from its stock.
  const total = (warehouse as Warehouse & LocationTotals).totalUnits;
  const stock = useWarehouseStock(warehouse.id, canArchive && typeof total !== "number");
  const [confirmArchive, setConfirmArchive] = useState(false);

  const saved: WarehouseValues = {
    name: warehouse.name,
    address: warehouse.address ?? "",
    description: warehouse.description ?? "",
  };
  const form = useForm<WarehouseValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: saved,
  });

  const archived = warehouse.status === InventoryStatus.ARCHIVED;
  const heldUnits =
    typeof total === "number" ? total : (stock.data ?? []).reduce((n, s) => n + Math.max(0, s.quantity), 0);

  const onSubmit = (values: WarehouseValues) => {
    const unchanged = (Object.keys(saved) as (keyof WarehouseValues)[]).every(
      (k) => (values[k] ?? "") === saved[k],
    );
    if (unchanged) return onClose();
    update.mutate({ id: warehouse.id, body: values }, { onSuccess: onClose });
  };

  return (
    <>
      <Header title={readOnly ? "Warehouse" : "Edit warehouse"} />
      <form
        id={FORM_ID}
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
      >
        {readOnly ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <Info className="size-4" />
            You have view-only access to warehouses.
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="w-name">Name</Label>
          <Input id="w-name" className="h-10" disabled={readOnly} {...form.register("name")} />
          {form.formState.errors.name ? (
            <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="w-address">Address</Label>
          <Input
            id="w-address"
            className="h-10"
            placeholder="Street, city, state"
            disabled={readOnly}
            {...form.register("address")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="w-desc">Description</Label>
          <Textarea id="w-desc" rows={3} disabled={readOnly} {...form.register("description")} />
        </div>
      </form>

      <DialogFooter className="m-0 flex-none">
        {canArchive && !archived ? (
          <Button
            variant="outline"
            className="gap-1.5 text-destructive hover:text-destructive sm:mr-auto"
            onClick={() => setConfirmArchive(true)}
          >
            <Archive className="size-4" />
            Archive
          </Button>
        ) : null}
        {readOnly ? (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} disabled={update.isPending} className="gap-1.5">
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </>
        )}
      </DialogFooter>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{warehouse.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It&apos;s hidden from active lists and transfer targets. Archiving doesn&apos;t move its stock.
              {heldUnits > 0 ? (
                <>
                  {" "}
                  This warehouse still holds <b>{heldUnits.toLocaleString()} units</b> — move them out
                  first if you don&apos;t want them stranded.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => archive.mutate(warehouse.id, { onSuccess: onClose })}
            >
              Archive warehouse
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Header({ title, description }: { title: string; description?: string }) {
  return (
    // Right padding keeps the title clear of the close button.
    <DialogHeader className="border-b px-4 py-3 pr-12">
      <DialogTitle className="text-base">{title}</DialogTitle>
      <DialogDescription className={description ? undefined : "sr-only"}>
        {description ?? "The warehouse's name, address and description."}
      </DialogDescription>
    </DialogHeader>
  );
}
