"use client";

import { useState } from "react";
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
import { useCreateContainer } from "../hooks";
import { containerSchema, type ContainerValues } from "../schemas";
import { TechnicianSelect, type TechnicianOption } from "./technician-select";

export function ContainerCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const create = useCreateContainer();
  const [technician, setTechnician] = useState<TechnicianOption | null>(null);
  const form = useForm<ContainerValues>({
    resolver: zodResolver(containerSchema),
    defaultValues: { name: "", description: "", department: "" },
  });

  const onSubmit = (values: ContainerValues) =>
    create.mutate(
      {
        ...values,
        technicianId: technician?.id,
        technicianName: technician?.name,
      },
      {
        onSuccess: (c) => {
          form.reset();
          setTechnician(null);
          onOpenChange(false);
          router.push(`/inventory/containers/${c.id}`);
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New container</DialogTitle>
          <DialogDescription>
            A mobile stock location — a van or truck. Assign a technician now or
            later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="ct-name">Name</Label>
            <Input id="ct-name" className="h-10" placeholder="Van 1" {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-desc">Description</Label>
            <Textarea id="ct-desc" rows={2} placeholder="Optional notes" {...form.register("description")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-department">Department</Label>
            <Input id="ct-department" className="h-10" {...form.register("department")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-tech">Technician</Label>
            <TechnicianSelect
              id="ct-tech"
              value={technician?.id ?? null}
              onChange={setTechnician}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={create.isPending} className="gap-1.5">
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create container
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
