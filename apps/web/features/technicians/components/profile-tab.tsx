"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { TechnicianProfile, TechnicianProfileStatus } from "@bitcrm/types";
import { MapsProvider } from "@/components/maps/maps-provider";
import { AddressAutocomplete } from "@/components/maps/address-autocomplete";
import { useProfile, useUpdateProfile } from "../hooks";
import { profileSchema, type ProfileValues } from "../schemas";

export function ProfileTab({
  technicianId,
  readOnly,
}: {
  technicianId: string;
  readOnly?: boolean;
}) {
  const { data: profile, isLoading } = useProfile(technicianId);
  if (isLoading || !profile) return <Skeleton className="h-96 w-full max-w-xl" />;
  return <ProfileForm key={profile.updatedAt} technicianId={technicianId} profile={profile} readOnly={readOnly} />;
}

function ProfileForm({
  technicianId,
  profile,
  readOnly,
}: {
  technicianId: string;
  profile: TechnicianProfile;
  readOnly?: boolean;
}) {
  const update = useUpdateProfile();
  const a = profile.homeAddress;
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      phone: profile.phone ?? "",
      line1: a?.line1 ?? "",
      line2: a?.line2 ?? "",
      city: a?.city ?? "",
      state: a?.state ?? "",
      zip: a?.zip ?? "",
      // Carried through so a save that doesn't touch the address keeps the
      // technician on the dispatch map.
      lat: a?.lat,
      lng: a?.lng,
      laborCostPerHour: profile.laborCostPerHour,
      callMaskingEnabled: profile.callMaskingEnabled,
      gpsTrackingEnabled: profile.gpsTrackingEnabled,
      mobileAppInstalled: profile.mobileAppInstalled,
      status: profile.status,
    },
  });
  const { register, control, setValue, handleSubmit } = form;
  const status = useWatch({ control, name: "status" });
  const callMasking = useWatch({ control, name: "callMaskingEnabled" });
  const gps = useWatch({ control, name: "gpsTrackingEnabled" });
  const mobile = useWatch({ control, name: "mobileAppInstalled" });
  const line1 = useWatch({ control, name: "line1" }) ?? "";

  const onSubmit = (v: ProfileValues) => {
    const homeAddress =
      v.line1 && v.city && v.state && v.zip
        ? { line1: v.line1, line2: v.line2 || undefined, city: v.city, state: v.state, zip: v.zip, lat: v.lat, lng: v.lng }
        : undefined;
    update.mutate({
      id: technicianId,
      body: {
        phone: v.phone || undefined,
        homeAddress,
        laborCostPerHour: v.laborCostPerHour,
        callMaskingEnabled: v.callMaskingEnabled,
        gpsTrackingEnabled: v.gpsTrackingEnabled,
        mobileAppInstalled: v.mobileAppInstalled,
        status: v.status,
      },
    });
  };

  return (
    <MapsProvider>
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-7" noValidate>
      <Group label="Contact (self-filled)">
        <Field label="Phone">
          <Input className="h-10" disabled={readOnly} {...register("phone")} />
        </Field>
        <Field label="Address line 1">
          {readOnly ? (
            <Input className="h-10" disabled {...register("line1")} />
          ) : (
            <AddressAutocomplete
              className="h-10"
              placeholder="Street"
              value={line1}
              onChange={(v) => setValue("line1", v, { shouldDirty: true })}
              onSelect={(address) => {
                setValue("line1", address.street, { shouldDirty: true });
                setValue("line2", address.unit ?? "", { shouldDirty: true });
                setValue("city", address.city, { shouldDirty: true });
                setValue("state", address.state, { shouldDirty: true });
                setValue("zip", address.zip, { shouldDirty: true });
                setValue("lat", address.lat, { shouldDirty: true });
                setValue("lng", address.lng, { shouldDirty: true });
              }}
            />
          )}
        </Field>
        <Field label="Address line 2">
          <Input className="h-10" disabled={readOnly} {...register("line2")} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="City"><Input className="h-10" disabled={readOnly} {...register("city")} /></Field>
          <Field label="State"><Input className="h-10" disabled={readOnly} {...register("state")} /></Field>
          <Field label="ZIP"><Input className="h-10" disabled={readOnly} {...register("zip")} /></Field>
        </div>
      </Group>

      <Group label="Operational (manager-controlled)">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Labor cost / hour">
            <Input type="number" step="0.01" min="0" className="h-10 tabular-nums" disabled={readOnly} {...register("laborCostPerHour")} />
          </Field>
          <Field label="Status">
            <Select value={status} disabled={readOnly} onValueChange={(v) => setValue("status", v as TechnicianProfileStatus)}>
              <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Toggle label="Call masking" hint="Hide the tech's number on calls" checked={callMasking} disabled={readOnly} onChange={(c) => setValue("callMaskingEnabled", c)} />
        <Toggle label="GPS tracking" hint="Location during shifts" checked={gps} disabled={readOnly} onChange={(c) => setValue("gpsTrackingEnabled", c)} />
        <Toggle label="Mobile app installed" checked={mobile} disabled={readOnly} onChange={(c) => setValue("mobileAppInstalled", c)} />
      </Group>

      {!readOnly ? (
        <div className="flex justify-end">
          <Button type="submit" variant="brand" disabled={update.isPending} className="gap-1.5">
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      ) : null}
    </form>
    </MapsProvider>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="border-b pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</h3>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (c: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}
