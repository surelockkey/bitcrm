"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useCreateWarehouse } from "../hooks";
import { warehouseSchema, type WarehouseValues } from "../schemas";

export function WarehouseCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const create = useCreateWarehouse();
  const form = useForm<WarehouseValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: { name: "", address: "", description: "" },
  });

  const onSubmit = (values: WarehouseValues) =>
    create.mutate(values, {
      onSuccess: (w) => {
        form.reset();
        onOpenChange(false);
        router.push(`/inventory/warehouses/${w.id}`);
      },
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New warehouse</DialogTitle>
          <DialogDescription>A physical stock location.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="wh-name">Name</Label>
            <Input id="wh-name" className="h-10" {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-address">Address</Label>
            <Input id="wh-address" className="h-10" placeholder="Street, city, state" {...form.register("address")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-desc">Description</Label>
            <Textarea id="wh-desc" rows={2} placeholder="Optional notes" {...form.register("description")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={create.isPending} className="gap-1.5">
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create warehouse
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
