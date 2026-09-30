"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import type { EstimateWithItems } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateEstimate } from "../hooks";
import { newEstimateSchema, type NewEstimateValues } from "../schemas";

export function NewEstimateDialog({
  dealId,
  jobItemCount,
  open,
  onOpenChange,
  onCreated,
}: {
  dealId: string;
  jobItemCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (estimate: EstimateWithItems) => void;
}) {
  const create = useCreateEstimate(dealId);
  const form = useForm<NewEstimateValues>({
    resolver: zodResolver(newEstimateSchema),
    defaultValues: { name: "", copyJobItems: jobItemCount > 0 },
  });
  const copy = useWatch({ control: form.control, name: "copyJobItems" });

  const submit = (v: NewEstimateValues) =>
    create.mutate(
      { name: v.name || undefined, copyJobItems: v.copyJobItems },
      {
        onSuccess: (e) => {
          form.reset();
          onOpenChange(false);
          onCreated(e);
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New estimate</DialogTitle>
          <DialogDescription>Offer the client one or more options before the work is done.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="estimate-name">
              Name <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="estimate-name" className="h-9" placeholder="e.g. Good / Better / Best" {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={copy}
              disabled={jobItemCount === 0}
              onCheckedChange={(v) => form.setValue("copyJobItems", v === true)}
              aria-label="Copy current job items"
              className="mt-0.5"
            />
            <span>
              Copy current job items
              <span className="block text-xs text-muted-foreground">
                {jobItemCount === 0
                  ? "The job has no items yet."
                  : `Starts the estimate with the job's ${jobItemCount} item${jobItemCount === 1 ? "" : "s"}.`}
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Create estimate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
