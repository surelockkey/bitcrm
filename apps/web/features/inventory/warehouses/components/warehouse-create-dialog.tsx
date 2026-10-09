"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { WzButton } from "@/components/workiz/button";
import {
  LocationDialog,
  LocationFields,
  LocationFooter,
  LocationInput,
  LocationTextarea,
} from "@/features/inventory/components/location-form";
import { useCreateWarehouse } from "../hooks";
import { warehouseSchema, type WarehouseValues } from "../schemas";

/** Workiz's "Create New Location" for a warehouse: Location Name, ours Address, Description; Cancel / Save. */
export function WarehouseCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateWarehouse();
  const form = useForm<WarehouseValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: { name: "", address: "", description: "" },
  });

  const onSubmit = (values: WarehouseValues) =>
    create.mutate(values, {
      // The new warehouse shows up in the list; stock reaches it from the Inventory tab.
      onSuccess: () => {
        form.reset();
        onOpenChange(false);
      },
    });

  return (
    <LocationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Location"
      description="A new warehouse: its name, address and description."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
        <LocationFields>
          <LocationInput label="Location Name" error={form.formState.errors.name?.message} {...form.register("name")} />
          <LocationInput label="Address" {...form.register("address")} />
          <LocationTextarea label="Description" {...form.register("description")} />
        </LocationFields>
        <LocationFooter>
          <WzButton variant="tertiary" size="big" onClick={() => onOpenChange(false)}>
            Cancel
          </WzButton>
          <WzButton type="submit" variant="primary" size="big" loading={create.isPending}>
            Save
          </WzButton>
        </LocationFooter>
      </form>
    </LocationDialog>
  );
}
