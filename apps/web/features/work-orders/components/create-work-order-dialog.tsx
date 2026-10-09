"use client";

import { Loader2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCreateWorkOrder } from "../hooks";
import { workOrderFormSchema, type WorkOrderFormValues } from "../schemas";

/** "+ Add New": a work order a Platinum client sent — its number, date, client, amount and words. */
export function CreateWorkOrderDialog({
  open,
  onOpenChange,
  companies,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companies: { id: string; title: string }[];
}) {
  const create = useCreateWorkOrder();
  const form = useForm<WorkOrderFormValues>({
    resolver: zodResolver(workOrderFormSchema),
    defaultValues: { woNumber: "", companyId: "", date: "", description: "" },
  });

  const selectedCompany = useWatch({ control: form.control, name: "companyId" });

  const submit = (v: WorkOrderFormValues) =>
    create.mutate(v, { onSuccess: () => { form.reset(); onOpenChange(false); } });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New work order</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>WO number</Label>
              <Input className="h-9" placeholder="WO-2026-11-005" {...form.register("woNumber")} />
              {form.formState.errors.woNumber ? <p className="text-xs text-destructive">{form.formState.errors.woNumber.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" className="h-9" {...form.register("date")} />
              {form.formState.errors.date ? <p className="text-xs text-destructive">{form.formState.errors.date.message}</p> : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Company</Label>
            <Select value={selectedCompany} onValueChange={(v) => form.setValue("companyId", v, { shouldValidate: true })}>
              <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.companyId ? <p className="text-xs text-destructive">{form.formState.errors.companyId.message}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input type="number" min={0} className="h-9" {...form.register("amount", { valueAsNumber: true })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input className="h-9" {...form.register("description")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" className="gap-1.5" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
