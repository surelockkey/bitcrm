"use client";

import { useId } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { TechnicianProfile, TechnicianProfileStatus, User } from "@bitcrm/types";
import { AddressAutocomplete } from "@/features/deals/components/address-autocomplete";
import { usePermissions } from "@/features/auth/use-permissions";
import { initials } from "@/features/users/lib";
import { useProfile, useUpdateProfile } from "../hooks";
import type { UpdateProfileBody } from "../api";
import { profileSchema, type ProfileValues } from "../schemas";
import { useSetClientNumberVisibility } from "../masking-hooks";
import type { TechnicianEditRights } from "../lib";
import { PERSON_NOT_CONNECTED, WORK_NOT_CONNECTED } from "../not-connected";
import { NotConnectedField } from "./not-connected-field";
import { ScheduleColorField } from "./schedule-color-field";

/** Said under a live control the viewer may read but not set. */
const MANAGER_ONLY = "A manager sets this.";
const NOT_YOURS = "You can read this technician's details but not change them.";

/**
 * The technician card: one form in two columns — the person on the left, the
 * work on the right — in the order and grouping of the Workiz user page the
 * owner asked us to match (`app.workiz.com/root/editUser/460479`, read off the
 * live page 2026-09-17; the field-by-field comparison is in
 * `WORKIZ_USER_PAGE_PARITY.md`).
 *
 * It used to be two tabs, Profile and Assignments, which only ever split one
 * form: setting a technician up meant hopping between them to answer "what can
 * this person do, and where" — the two halves of one question.
 *
 * Fields Workiz has and we hold no data for are drawn dead, in their place,
 * from `not-connected.ts`. Fields we have and Workiz doesn't (status, mobile
 * app) sit at the foot of the work column under a heading that says they are
 * ours, rather than being slipped into their order.
 *
 * Editing follows the API's own split rather than one permission: contact
 * details are the technician's own, operational fields are a manager's — see
 * `technicianEditRights`.
 */
export function TechnicianForm({
  technicianId,
  user,
  roleLabel,
  rights,
}: {
  technicianId: string;
  user?: User;
  roleLabel: string;
  rights: TechnicianEditRights;
}) {
  const { data: profile, isLoading } = useProfile(technicianId);
  if (isLoading || !profile) {
    return (
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        <Skeleton className="h-[28rem] w-full" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    );
  }
  return (
    <Form
      key={profile.updatedAt}
      technicianId={technicianId}
      profile={profile}
      user={user}
      roleLabel={roleLabel}
      rights={rights}
    />
  );
}

function Form({
  technicianId,
  profile,
  user,
  roleLabel,
  rights,
}: {
  technicianId: string;
  profile: TechnicianProfile;
  user?: User;
  roleLabel: string;
  rights: TechnicianEditRights;
}) {
  const { can } = usePermissions();
  const update = useUpdateProfile();
  const fieldId = useId();
  const id = (name: string) => `${fieldId}-${name}`;
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

  const canSave = rights.contact || rights.operational;
  const contactHint = rights.contact ? undefined : NOT_YOURS;
  const workHint = rights.operational ? undefined : MANAGER_ONLY;

  /**
   * Only what this viewer may set goes into the body. The API refuses the WHOLE
   * update when an operational field is present and the caller is not a
   * manager, so a technician saving their own address must not carry their
   * (unchanged) labor cost along with it.
   */
  const onSubmit = (v: ProfileValues) => {
    const body: UpdateProfileBody = {};
    if (rights.contact) {
      body.phone = v.phone || undefined;
      body.homeAddress =
        v.line1 && v.city && v.state && v.zip
          ? { line1: v.line1, line2: v.line2 || undefined, city: v.city, state: v.state, zip: v.zip, lat: v.lat, lng: v.lng }
          : undefined;
    }
    if (rights.operational) {
      body.laborCostPerHour = v.laborCostPerHour;
      body.callMaskingEnabled = v.callMaskingEnabled;
      body.gpsTrackingEnabled = v.gpsTrackingEnabled;
      body.mobileAppInstalled = v.mobileAppInstalled;
      body.status = v.status;
    }
    update.mutate({ id: technicianId, body });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden" noValidate>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-5xl space-y-6">
      <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
        {/* ---------------- The person ---------------- */}
        <div className="space-y-5" data-testid="person-column">
          <ColumnHeading>Person</ColumnHeading>

          <Field
            label="Profile picture"
            hint={
              // The photo is one of the technician's documents, uploaded there
              // by the person themselves — so the pointer is only true for a
              // viewer who can see that block.
              can("documents", "view")
                ? "Uploaded with their documents, further down this page."
                : "Set from the technician's own documents."
            }
          >
            <Avatar size="lg" className="size-16">
              {profile.profilePhotoUrl ? <AvatarImage src={profile.profilePhotoUrl} alt="" /> : null}
              <AvatarFallback className="text-lg">{initials(user?.firstName, user?.lastName)}</AvatarFallback>
            </Avatar>
          </Field>

          <NotConnectedField field={PERSON_NOT_CONNECTED.userType} />

          {/* All three are disabled for the same reason, said once under the
              last of them — so all three point at that one line rather than
              leaving the first two disabled with no reason given. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor={id("first")}>
              <Input
                id={id("first")}
                className="h-10"
                value={user?.firstName ?? ""}
                readOnly
                disabled
                aria-describedby={id("user-record")}
              />
            </Field>
            <Field label="Last name" htmlFor={id("last")}>
              <Input
                id={id("last")}
                className="h-10"
                value={user?.lastName ?? ""}
                readOnly
                disabled
                aria-describedby={id("user-record")}
              />
            </Field>
          </div>

          <Field label="Email" htmlFor={id("email")}>
            <Input
              id={id("email")}
              className="h-10"
              value={user?.email ?? ""}
              readOnly
              disabled
              aria-describedby={id("user-record")}
            />
            <p id={id("user-record")} className="text-xs text-muted-foreground">
              Name and email live on the user record.
              {can("users", "view") ? (
                <>
                  {" "}
                  <Link href="/admin/users" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                    Open Users <ArrowUpRight className="size-3" />
                  </Link>
                </>
              ) : null}
            </p>
          </Field>

          <Field
            label="Phone"
            htmlFor={id("phone")}
            hint={
              contactHint ??
              "The number we ring for this technician, and the one that identifies them in the call log."
            }
            error={form.formState.errors.phone?.message}
          >
            {/* Saved onto the user record, not this one — the same number the
                technician sets on their own account page. Workiz gives the
                country code a box of its own; ours is part of this control. */}
            <PhoneInput
              id={id("phone")}
              disabled={!rights.contact}
              value={phone}
              onChange={(v) => setValue("phone", v, { shouldValidate: true, shouldDirty: true })}
            />
          </Field>

          <NotConnectedField field={PERSON_NOT_CONNECTED.additionalPhones} />

          {/* Our address is line1/line2/city/state/zip; Workiz shows one
              "Home address". The pieces stay — the dispatch map geocodes them —
              but they are laid out and announced as the one block they are. */}
          <div className="space-y-1.5" role="group" aria-labelledby={id("address-label")}>
            <Label id={id("address-label")}>Home address</Label>
            {rights.contact ? (
              /* Named, not just placeheld: the group's label names the block,
                 and a combobox with only a placeholder is announced unnamed —
                 the disabled twin below has carried this name all along. */
              <AddressAutocomplete
                id={id("line1")}
                ariaLabel="Street address"
                placeholder="Street address"
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
            ) : (
              <Input
                id={id("line1")}
                className="h-10"
                aria-label="Street address"
                aria-describedby={id("address-hint")}
                disabled
                {...register("line1")}
              />
            )}
            <Input
              className="h-10"
              aria-label="Apartment or suite"
              aria-describedby={id("address-hint")}
              placeholder="Apt, suite (optional)"
              disabled={!rights.contact}
              {...register("line2")}
            />
            <div className="grid grid-cols-3 gap-3">
              <Input className="h-10" aria-label="City" aria-describedby={id("address-hint")} placeholder="City" disabled={!rights.contact} {...register("city")} />
              <Input className="h-10" aria-label="State" aria-describedby={id("address-hint")} placeholder="State" disabled={!rights.contact} {...register("state")} />
              <Input className="h-10" aria-label="ZIP" aria-describedby={id("address-hint")} placeholder="ZIP" disabled={!rights.contact} {...register("zip")} />
            </div>
            <p id={id("address-hint")} className="text-xs text-muted-foreground">
              {contactHint ?? "Used to route jobs near them."}
            </p>
          </div>

          {/* Workiz's words, on their page and in their app. Ours read "GPS
              tracking" — the same switch under a name nobody in the field
              uses. */}
          <Toggle
            label="Track location"
            hint={workHint ?? "Their position during shifts, on the dispatch map."}
            checked={gps}
            disabled={!rights.operational}
            onChange={(c) => setValue("gpsTrackingEnabled", c, { shouldDirty: true })}
          />
        </div>

        {/* ---------------- The work ---------------- */}
        <div className="space-y-5" data-testid="work-column">
          <ColumnHeading>Work</ColumnHeading>

          <Field label="Role">
            <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{roleLabel}</div>
            {can("roles", "view") ? (
              <p className="text-xs">
                <Link href="/admin/roles" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                  Customize roles and permissions here <ArrowUpRight className="size-3" />
                </Link>
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              The role itself is assigned on the user record, where the change
              is confirmed and this person&apos;s overrides are reset.
            </p>
          </Field>

          <NotConnectedField field={WORK_NOT_CONNECTED.fieldTeamMember} />

          <Field
            label="Labor cost per hour"
            htmlFor={id("labor-cost")}
            hint={workHint}
            hintId={id("labor-cost-hint")}
            error={form.formState.errors.laborCostPerHour?.message}
          >
            <div className="relative">
              <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                id={id("labor-cost")}
                type="number"
                step="0.01"
                min="0"
                className="h-10 pl-7 tabular-nums"
                disabled={!rights.operational}
                aria-describedby={workHint ? id("labor-cost-hint") : undefined}
                {...register("laborCostPerHour")}
              />
            </div>
          </Field>

          {/* Job types and service areas keep their own tab, where this card
              has always had them. Workiz puts them in this column; a tab the
              reader already knows beats a column that matches a screenshot.

              Workiz's "User skills" is not here at all: skills are a separate
              catalog there and we hold job types only, so a dead row would
              promise a second catalog we have no plans for. */}
          <ScheduleColorField disabled={!rights.operational} />

          {/* The label used to read "Hide the tech's number on calls", which is
              what a manager WANTS but not what the switch does. It hides CLIENT
              numbers from the technician; their own number is hidden from
              clients by every masked call, always, and is not optional. Workiz
              calls the row "Call masking", which says even less about which way
              round it runs, so ours stays.

              It writes through the permission that actually governs this, so
              there is only ever one switch — two switches for one behaviour is
              how a privacy setting ends up wrong. */}
          <Toggle
            label="Hide client numbers"
            hint={workHint ?? "They see the client's name and call through the system, never the number"}
            checked={callMasking}
            disabled={!rights.operational || maskingPending}
            onChange={(c) => {
              setValue("callMaskingEnabled", c, { shouldDirty: true });
              setMasking.mutate({ userId: technicianId, hideNumbers: c });
            }}
          />

          <NotConnectedField field={WORK_NOT_CONNECTED.twoFactor} />
          <NotConnectedField field={WORK_NOT_CONNECTED.notes} />

          <div className="space-y-5 border-t pt-5">
            {/* Ours, not Workiz's — kept together and labelled, rather than
                slipped into their order where it would read as parity. */}
            <ColumnHeading>Not on the Workiz card — ours</ColumnHeading>
            <Field label="Status" htmlFor={id("status")} hint={workHint} hintId={id("status-hint")}>
              <Select
                value={status}
                disabled={!rights.operational}
                onValueChange={(v) => setValue("status", v as TechnicianProfileStatus, { shouldDirty: true })}
              >
                <SelectTrigger
                  id={id("status")}
                  className="h-10 w-full"
                  aria-describedby={workHint ? id("status-hint") : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Toggle
              label="Mobile app installed"
              hint={workHint}
              checked={mobile}
              disabled={!rights.operational}
              onChange={(c) => setValue("mobileAppInstalled", c, { shouldDirty: true })}
            />
          </div>
        </div>
      </div>

        </div>
      </div>

      {canSave ? (
        // Pinned, centred, exactly as the job card does it: the fields above
        // own the scroll, this bar never moves, and it sits under the middle
        // because it saves both columns, not the one it would hug in a corner.
        <div className="flex items-center justify-center gap-2 border-t bg-background px-6 py-4 shadow-[0_-6px_16px_-8px_rgba(0,0,0,0.15)]">
          <Button type="submit" variant="brand" disabled={update.isPending} className="gap-1.5">
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      ) : (
        <div className="border-t bg-background px-6 py-4 text-center text-xs text-muted-foreground">
          You can read this card but not change it.
        </div>
      )}
    </form>
  );
}

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

/**
 * A labelled field. `htmlFor` ties the label to the control it belongs to —
 * without it a label is only text sitting above a box, and a screen reader
 * announces the box unnamed. Fields that hold several inputs (the address)
 * name each input themselves and use the label as the group's heading.
 */
function Field({
  label,
  htmlFor,
  hint,
  hintId,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  /** Set where the hint is the reason a control is disabled, so the control
   *  can point at it: a greyed box with its explanation floating free beside it
   *  is, to anyone hearing the page, a greyed box with no explanation. */
  hintId?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p id={hintId} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * A switch with its name and its one line of explanation beside it. The switch
 * is a button, not a checkbox, so a wrapping `<label>` would not name it — the
 * text is tied on by id instead, and the hint (which is where "a manager sets
 * this" is said) is tied on as its description.
 */
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
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span>
        <span id={labelId} className="block text-sm font-medium">{label}</span>
        {hint ? <span id={hintId} className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
      />
    </div>
  );
}
