"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
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
import { AddressAutocomplete } from "@/features/deals/components/address-autocomplete";
import { useProfile, useUpdateProfile } from "../hooks";
import { WorkingHoursEditor } from "@/features/schedule/components/working-hours-editor";
import { profileSchema, type ProfileValues } from "../schemas";
import { useSetClientNumberVisibility } from "../masking-hooks";

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
  const setMasking = useSetClientNumberVisibility();
  const maskingPending = setMasking.isPending;
  const status = useWatch({ control, name: "status" });
  const callMasking = useWatch({ control, name: "callMaskingEnabled" });
  const gps = useWatch({ control, name: "gpsTrackingEnabled" });
  const mobile = useWatch({ control, name: "mobileAppInstalled" });
  const phone = useWatch({ control, name: "phone" }) ?? "";
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
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-7" noValidate>
      <Group label="Contact (self-filled)">
        <Field label="Phone">
          <PhoneInput disabled={readOnly} value={phone} onChange={(v) => setValue("phone", v, { shouldValidate: true, shouldDirty: true })} />
          {/* Saved onto the user record, not this one — the same number the
              technician sets on their own account page. */}
          <p className="text-xs text-muted-foreground">
            The number we ring for this technician, and the one that identifies
            them in the call log.
          </p>
          {form.formState.errors.phone ? <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p> : null}
        </Field>
        <Field label="Address line 1">
          {readOnly ? (
            <Input className="h-10" disabled {...register("line1")} />
          ) : (
            <AddressAutocomplete
              value={line1}
              onChange={(v) => setValue("line1", v, { shouldDirty: true })}
              onSelect={(address) => {
                setValue("line1", address.street, { shouldDirty: true });
                setValue("city", address.city, { shouldDirty: true });
                setValue("state", address.state, { shouldDirty: true });
                setValue("zip", address.zip, { shouldDirty: true });
                if (address.lat != null) setValue("lat", address.lat, { shouldDirty: true });
                if (address.lng != null) setValue("lng", address.lng, { shouldDirty: true });
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
        {/* The label used to read "Hide the tech's number on calls", which is
            what a manager WANTS but not what the switch does. It hides CLIENT
            numbers from the technician; their own number is hidden from clients
            by every masked call, always, and is not optional.

            It writes through the permission that actually governs this, so
            there is only ever one switch — two switches for one behaviour is
            how a privacy setting ends up wrong. */}
        <Toggle
          label="Hide client numbers"
          hint="They see the client's name and call through the system, never the number"
          checked={callMasking}
          disabled={readOnly || maskingPending}
          onChange={(c) => {
            setValue("callMaskingEnabled", c);
            setMasking.mutate({ userId: technicianId, hideNumbers: c });
          }}
        />
        <Toggle label="GPS tracking" hint="Location during shifts" checked={gps} disabled={readOnly} onChange={(c) => setValue("gpsTrackingEnabled", c)} />
        <Toggle label="Mobile app installed" checked={mobile} disabled={readOnly} onChange={(c) => setValue("mobileAppInstalled", c)} />
      </Group>

      <Group label="Schedule">
        <WorkingHoursEditor profile={profile} readOnly={readOnly} />
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
