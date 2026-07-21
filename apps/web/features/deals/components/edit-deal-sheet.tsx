"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { DealPriority } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateDeal } from "../hooks";
import { editDealSchema, type EditDealValues } from "../schemas";
import { jobTypeLabel } from "../lib";
import { AddressAutocomplete } from "./address-autocomplete";
import { ResolvedAreaField } from "@/features/service-areas/components/resolved-area-field";

const JOB_TYPES = ["lockout", "rekey", "lock_change", "installation", "repair", "safe", "automotive", "commercial", "other"];

export function EditDealSheet({ deal, open, onOpenChange }: { deal: Deal; open: boolean; onOpenChange: (v: boolean) => void }) {
  const update = useUpdateDeal(deal.id);
  const [tagsStr, setTagsStr] = useState(deal.tags.join(", "));

  const form = useForm<EditDealValues>({
    resolver: zodResolver(editDealSchema),
    defaultValues: {
      jobType: deal.jobType,
      serviceArea: deal.serviceArea,
      address: {
        street: deal.address.street,
        unit: deal.address.unit ?? "",
        city: deal.address.city,
        state: deal.address.state,
        zip: deal.address.zip,
        lat: deal.address.lat,
        lng: deal.address.lng,
      },
      scheduledDate: deal.scheduledDate ?? "",
      scheduledTimeSlot: deal.scheduledTimeSlot ?? "",
      priority: deal.priority,
      source: deal.source ?? "",
      notes: deal.notes ?? "",
      internalNotes: deal.internalNotes ?? "",
      tags: deal.tags,
    },
  });

  const submit = (v: EditDealValues) => {
    const tags = tagsStr.split(",").map((t) => t.trim()).filter(Boolean);
    update.mutate(
      {
        ...v,
        scheduledDate: v.scheduledDate || undefined,
        scheduledTimeSlot: v.scheduledTimeSlot || undefined,
        source: v.source || undefined,
        notes: v.notes || undefined,
        internalNotes: v.internalNotes || undefined,
        tags,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const err = form.formState.errors;
  const jobType = useWatch({ control: form.control, name: "jobType" });
  const priority = useWatch({ control: form.control, name: "priority" });
  const street = useWatch({ control: form.control, name: "address.street" });
  const lat = useWatch({ control: form.control, name: "address.lat" });
  const lng = useWatch({ control: form.control, name: "address.lng" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4"><SheetTitle>Edit deal #{deal.dealNumber}</SheetTitle></SheetHeader>
        <form onSubmit={form.handleSubmit(submit)} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-4 px-5 py-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Job type</Label>
                <Select value={jobType} onValueChange={(v) => form.setValue("jobType", v)}>
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{JOB_TYPES.map((t) => <SelectItem key={t} value={t}>{jobTypeLabel(t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => form.setValue("priority", v as DealPriority)}>
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={DealPriority.NORMAL}>Normal</SelectItem><SelectItem value={DealPriority.URGENT}>Urgent</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <ResolvedAreaField lat={lat} lng={lng} />
            <div className="space-y-1.5">
              <Label>Address</Label>
              <AddressAutocomplete
                value={street ?? ""}
                onChange={(val) => form.setValue("address.street", val, { shouldValidate: true })}
                onSelect={(a) => {
                  form.setValue("address.street", a.street, { shouldValidate: true });
                  form.setValue("address.city", a.city, { shouldValidate: true });
                  form.setValue("address.state", a.state, { shouldValidate: true });
                  form.setValue("address.zip", a.zip, { shouldValidate: true });
                  if (a.lat != null) form.setValue("address.lat", a.lat);
                  if (a.lng != null) form.setValue("address.lng", a.lng);
                }}
              />
              {err.address?.street ? <p className="text-xs text-destructive">{err.address.street.message}</p> : null}
              <div className="mt-2 grid grid-cols-[1fr_2fr_1fr_1fr] gap-2">
                <Input className="h-9" placeholder="Unit" {...form.register("address.unit")} />
                <Input className="h-9" placeholder="City" {...form.register("address.city")} />
                <Input className="h-9" placeholder="State" {...form.register("address.state")} />
                <Input className="h-9" placeholder="ZIP" {...form.register("address.zip")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Scheduled date</Label><Input className="h-9" type="date" {...form.register("scheduledDate")} /></div>
              <div className="space-y-1.5"><Label>Time slot</Label><Input className="h-9" placeholder="09:00-12:00" {...form.register("scheduledTimeSlot")} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Source</Label><Input className="h-9" {...form.register("source")} /></div>
              <div className="space-y-1.5"><Label>Tags</Label><Input className="h-9" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea rows={2} {...form.register("notes")} /></div>
            <div className="space-y-1.5"><Label>Internal notes</Label><Textarea rows={2} {...form.register("internalNotes")} /></div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" className="gap-1.5" disabled={update.isPending}>
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
