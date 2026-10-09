"use client";

import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { WzConfirm } from "@/features/inventory/item-edit/wz";
import {
  LocationDialog,
  LocationFields,
  LocationFooter,
  LocationInput,
  LocationTextarea,
} from "@/features/inventory/components/location-form";
import type { LocationTotals } from "@/features/inventory/stock/lib";
import { useArchiveWarehouse, useUpdateWarehouse, useWarehouse, useWarehouseStock } from "../hooks";
import { warehouseSchema, type WarehouseValues } from "../schemas";

/**
 * A warehouse's Workiz "Edit Location" popup — Inventory has no warehouse
 * page. Opened from the row's pencil; view-only without `warehouses.edit`.
 * BitCRM archives rather than deletes: Archive sits at the footer's left.
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

  let title = canEdit ? "Edit Location" : "Location";
  let content: ReactNode;
  if (query.isLoading) {
    content = (
      <div data-testid="warehouse-edit-loading" aria-busy="true" className="flex flex-col">
        <LocationFields>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[132px] w-full" />
        </LocationFields>
        {/* The buttons' place, so the popup does not grow when the form arrives. */}
        <div data-testid="dialog-footer-placeholder" aria-hidden className="mt-[61px] flex justify-end gap-4">
          <Skeleton className="h-10 w-24 rounded-pill" />
          <Skeleton className="h-10 w-20 rounded-pill" />
        </div>
      </div>
    );
  } else if (query.isError || !query.data) {
    title = "Location not found";
    content = (
      <>
        <p className="mt-4 text-sm text-wz-outline-label">It may have been deleted.</p>
        <LocationFooter>
          <WzButton variant="secondary" size="big" onClick={close}>
            Close
          </WzButton>
        </LocationFooter>
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
    <LocationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="The warehouse's name, address and description."
    >
      {content}
    </LocationDialog>
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
  const form = useForm<WarehouseValues>({ resolver: zodResolver(warehouseSchema), defaultValues: saved });

  const archived = warehouse.status === InventoryStatus.ARCHIVED;
  const heldUnits =
    typeof total === "number" ? total : (stock.data ?? []).reduce((n, s) => n + Math.max(0, s.quantity), 0);

  const onSubmit = (values: WarehouseValues) => {
    const unchanged = (Object.keys(saved) as (keyof WarehouseValues)[]).every((k) => (values[k] ?? "") === saved[k]);
    if (unchanged) return onClose();
    update.mutate({ id: warehouse.id, body: values }, { onSuccess: onClose });
  };

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-col">
      <LocationFields>
        {readOnly ? (
          <p className="text-sm text-wz-outline-label">You have view-only access to warehouses.</p>
        ) : null}
        <LocationInput
          label="Location Name"
          disabled={readOnly}
          error={form.formState.errors.name?.message}
          {...form.register("name")}
        />
        <LocationInput label="Address" disabled={readOnly} {...form.register("address")} />
        <LocationTextarea label="Description" disabled={readOnly} {...form.register("description")} />
      </LocationFields>

      <LocationFooter
        start={
          canArchive && !archived ? (
            <WzButton variant="tertiary" size="big" className="text-wz-danger" onClick={() => setConfirmArchive(true)}>
              Archive
            </WzButton>
          ) : null
        }
      >
        {readOnly ? (
          <WzButton variant="secondary" size="big" onClick={onClose}>
            Close
          </WzButton>
        ) : (
          <>
            <WzButton variant="tertiary" size="big" onClick={onClose}>
              Cancel
            </WzButton>
            <WzButton type="submit" variant="primary" size="big" loading={update.isPending}>
              Save
            </WzButton>
          </>
        )}
      </LocationFooter>

      <WzConfirm
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive “${warehouse.name}”?`}
        confirmText="Archive warehouse"
        pending={archive.isPending}
        onConfirm={() => archive.mutate(warehouse.id, { onSuccess: onClose })}
        message={
          <>
            It&apos;s hidden from active lists and transfer targets. Archiving doesn&apos;t move its stock.
            {heldUnits > 0 ? (
              <>
                {" "}
                This warehouse still holds <b>{heldUnits.toLocaleString()} units</b> — move them out first if you
                don&apos;t want them stranded.
              </>
            ) : null}
          </>
        }
      />
    </form>
  );
}
