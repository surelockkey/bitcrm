"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Warehouse } from "@bitcrm/types";
import { useUpdateWarehouse } from "../hooks";
import { warehouseSchema, type WarehouseValues } from "../schemas";

export function WarehouseSettingsTab({
  warehouse,
  readOnly,
}: {
  warehouse: Warehouse;
  readOnly?: boolean;
}) {
  const update = useUpdateWarehouse();
  const form = useForm<WarehouseValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: {
      name: warehouse.name,
      address: warehouse.address ?? "",
      description: warehouse.description ?? "",
    },
  });

  const onSubmit = (values: WarehouseValues) =>
    update.mutate({ id: warehouse.id, body: values });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-xl space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="s-name">Name</Label>
        <Input id="s-name" className="h-10" disabled={readOnly} {...form.register("name")} />
        {form.formState.errors.name ? (
          <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-address">Address</Label>
        <Input
          id="s-address"
          className="h-10"
          placeholder="Street, city, state"
          disabled={readOnly}
          {...form.register("address")}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-desc">Description</Label>
        <Textarea id="s-desc" rows={3} disabled={readOnly} {...form.register("description")} />
      </div>
      {!readOnly ? (
        <div className="flex justify-end">
          <Button type="submit" variant="brand" disabled={update.isPending} className="gap-1.5">
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      ) : null}
    </form>
  );
}
