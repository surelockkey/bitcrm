"use client";

import { useId, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Upload, X } from "lucide-react";
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
import type {
  TechnicianProfile,
  TechnicianProfileStatus,
  TechnicianType,
  UpdateUserRequest,
  User,
} from "@bitcrm/types";
import { isFieldTeamMember } from "@bitcrm/types";
import { AddressAutocomplete } from "@/features/deals/components/address-autocomplete";
import { usePermissions } from "@/features/auth/use-permissions";
import { initials } from "@/features/users/lib";
import { useUpdateUser } from "@/features/users/hooks";
import { useDeletePhoto, useProfile, useUpdateProfile, useUploadPhoto } from "../hooks";
import type { UpdateProfileBody } from "../api";
import { profileSchema, type ProfileValues } from "../schemas";
import { useSetClientNumberVisibility } from "../masking-hooks";
import type { TechnicianEditRights } from "../lib";
import { WORK_NOT_CONNECTED } from "../not-connected";
import { AssignmentsSection } from "./assignments-section";
import { NotConnectedField } from "./not-connected-field";
import { ScheduleColorField } from "./schedule-color-field";

/** Said under a live control the viewer may read but not set. */
const MANAGER_ONLY = "A manager sets this.";
const NOT_YOURS = "You can read this technician's details but not change them.";
/** The name and the field-team switch: the user record's, behind `users.edit`. */
const ON_USER_RECORD = "Set on the user record, by someone who may edit users.";
const MAX_ADDITIONAL_PHONES = 5;

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
 * details are the technician's own, operational fields are a manager's, and
 * the name and the field-team switch are the user record's — see
 * `technicianEditRights`. One Save writes both records, each with only what
 * its viewer may set and, for the user record, only what changed.
 */
export function TechnicianForm({
  technicianId,
  user,
  rights,
}: {
  technicianId: string;
  user?: User;
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
      rights={rights}
    />
  );
}

function Form({
  technicianId,
  profile,
  user,
  rights,
}: {
  technicianId: string;
  profile: TechnicianProfile;
  user?: User;
  rights: TechnicianEditRights;
}) {
  const { can } = usePermissions();
  const update = useUpdateProfile();
  const updateUser = useUpdateUser();
  const fieldId = useId();
  const id = (name: string) => `${fieldId}-${name}`;
  const a = profile.homeAddress;
  // Unset on a record from before the switch: a technician is on the field
  // team until switched off, and nobody else is until switched on.
  const onFieldTeam = user ? isFieldTeamMember(user) : true;
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      fieldTeamMember: onFieldTeam,
      technicianType: profile.technicianType ?? "regular",
      phone: profile.phone ?? "",
      additionalPhones: profile.additionalPhones ?? [],
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
  const technicianType = useWatch({ control, name: "technicianType" });
  const fieldTeamMember = useWatch({ control, name: "fieldTeamMember" });
  const callMasking = useWatch({ control, name: "callMaskingEnabled" });
  const gps = useWatch({ control, name: "gpsTrackingEnabled" });
  const mobile = useWatch({ control, name: "mobileAppInstalled" });
  const phone = useWatch({ control, name: "phone" }) ?? "";
  const additionalPhones = useWatch({ control, name: "additionalPhones" }) ?? [];
  const line1 = useWatch({ control, name: "line1" }) ?? "";

  const canSave = rights.contact || rights.operational || rights.identity;
  const contactHint = rights.contact ? undefined : NOT_YOURS;
  const workHint = rights.operational ? undefined : MANAGER_ONLY;
  const identityHint = rights.identity ? undefined : ON_USER_RECORD;

  const setAdditionalPhones = (next: string[]) =>
    setValue("additionalPhones", next, { shouldDirty: true });

  /**
   * Only what this viewer may set goes into each body. The API refuses the
   * WHOLE profile update when an operational field is present and the caller
   * is not a manager, so a technician saving their own address must not carry
   * their (unchanged) labor cost along with it. The user record gets only
   * what changed: it is a different record, and an untouched one stays so.
   */
  const onSubmit = (v: ProfileValues) => {
    const body: UpdateProfileBody = {};
    if (rights.contact) {
      body.phone = v.phone || undefined;
      body.additionalPhones = v.additionalPhones.map((p) => p.trim()).filter(Boolean);
      body.homeAddress =
        v.line1 && v.city && v.state && v.zip
          ? { line1: v.line1, line2: v.line2 || undefined, city: v.city, state: v.state, zip: v.zip, lat: v.lat, lng: v.lng }
          : undefined;
    }
    if (rights.operational) {
      body.technicianType = v.technicianType;
      body.laborCostPerHour = v.laborCostPerHour;
      body.callMaskingEnabled = v.callMaskingEnabled;
      body.gpsTrackingEnabled = v.gpsTrackingEnabled;
      body.mobileAppInstalled = v.mobileAppInstalled;
      body.status = v.status;
    }
    if (rights.contact || rights.operational) update.mutate({ id: technicianId, body });

    if (rights.identity && user) {
      const person: UpdateUserRequest = {};
      const first = v.firstName.trim();
      const last = v.lastName.trim();
      if (first && first !== user.firstName) person.firstName = first;
      if (last && last !== user.lastName) person.lastName = last;
      if (v.fieldTeamMember !== isFieldTeamMember(user)) person.fieldTeamMember = v.fieldTeamMember;
      if (Object.keys(person).length > 0) updateUser.mutate({ id: technicianId, body: person });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden" noValidate>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl space-y-6">
      <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
        {/* ---------------- The person ---------------- */}
        <div className="space-y-5" data-testid="person-column">
          <ColumnHeading>Person</ColumnHeading>

          <ProfilePhotoField
            technicianId={technicianId}
            profile={profile}
            user={user}
            editable={rights.contact}
          />

          {/* Under the photo, where the owner asked for it. Workiz's words,
              on their page and in their app. Ours read "GPS tracking" — the
              same switch under a name nobody in the field uses. */}
          <Toggle
            label="Track location"
            hint={workHint ?? "Their position during shifts, on the dispatch map."}
            checked={gps}
            disabled={!rights.operational}
            onChange={(c) => setValue("gpsTrackingEnabled", c, { shouldDirty: true })}
          />

          {/* Workiz's "User type". A subcontractor is paid and insured
              differently from an employee, and more will hang off this as
              those differences are built — so it is the manager's to set. */}
          <Field
            label="User type"
            htmlFor={id("user-type")}
            hint={workHint ?? "A subcontractor is paid and insured differently from an employee."}
            hintId={id("user-type-hint")}
          >
            <Select
              value={technicianType}
              disabled={!rights.operational}
              onValueChange={(v) => setValue("technicianType", v as TechnicianType, { shouldDirty: true })}
            >
              <SelectTrigger id={id("user-type")} className="h-10 w-full" aria-describedby={id("user-type-hint")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">Regular</SelectItem>
                <SelectItem value="subcontractor">Subcontractor</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/* The name is the user record's. Whoever may edit users changes it
              here and it is written there; everyone else reads it, and the
              one line under the email says why. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor={id("first")}>
              <Input
                id={id("first")}
                className="h-10"
                disabled={!rights.identity}
                aria-describedby={rights.identity ? undefined : id("user-record")}
                {...register("firstName")}
              />
            </Field>
            <Field label="Last name" htmlFor={id("last")}>
              <Input
                id={id("last")}
                className="h-10"
                disabled={!rights.identity}
                aria-describedby={rights.identity ? undefined : id("user-record")}
                {...register("lastName")}
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
              {rights.identity
                ? "The email is the sign-in and can't be changed."
                : "Name and email live on the user record; the email is the sign-in and can't be changed."}
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

          {/* Workiz's "Additional phone numbers": a list, with an add. They
              live on the technician record; the user record holds exactly one
              number, the one telephony rings and the call log matches. */}
          <div className="space-y-1.5" role="group" aria-labelledby={id("additional-label")}>
            <Label id={id("additional-label")}>Additional phone numbers</Label>
            {additionalPhones.map((value, i) => (
              <div key={i} className="flex items-center gap-2">
                <Label htmlFor={id(`additional-${i}`)} className="sr-only">
                  Additional phone {i + 1}
                </Label>
                <div className="min-w-0 flex-1">
                  <PhoneInput
                    id={id(`additional-${i}`)}
                    disabled={!rights.contact}
                    value={value}
                    onChange={(v) =>
                      setAdditionalPhones(additionalPhones.map((p, j) => (j === i ? v : p)))
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 flex-none text-muted-foreground hover:text-destructive"
                  aria-label={`Remove additional phone ${i + 1}`}
                  disabled={!rights.contact}
                  onClick={() => setAdditionalPhones(additionalPhones.filter((_, j) => j !== i))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!rights.contact || additionalPhones.length >= MAX_ADDITIONAL_PHONES}
              onClick={() => setAdditionalPhones([...additionalPhones, ""])}
            >
              <Plus className="size-3.5" />
              Add number
            </Button>
            <p className="text-xs text-muted-foreground">
              {contactHint ?? "Other numbers to reach them on. Calls still ring the one above."}
            </p>
          </div>

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
        </div>

        {/* ---------------- The work ---------------- */}
        <div className="space-y-5" data-testid="work-column">
          <ColumnHeading>Work</ColumnHeading>

          {/* Workiz's "Field team member", and the one switch that decides who
              may be put on a job — whatever the role. It is the user record's,
              so it saves there, and only someone who may edit users sets it.
              The role itself is not on this card: it is assigned on the user
              record, where the change is confirmed and overrides are reset. */}
          <Toggle
            label="Field team member"
            hint={identityHint ?? "Goes out on jobs, and can be put on one."}
            checked={fieldTeamMember}
            disabled={!rights.identity}
            onChange={(c) => setValue("fieldTeamMember", c, { shouldDirty: true })}
          />

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

          {/* Job types and service areas, in this column under the labor
              cost, where Workiz has them — the owner moved them off their own
              tab on 2026-09-17. Each section owns its dialogs and its buttons
              are all type="button", so nothing in them submits this form.

              Workiz's "User skills" is not here at all: skills are a separate
              catalog there and we hold job types only, so a dead row would
              promise a second catalog we have no plans for. */}
          {can("job_types", "view") ? (
            <AssignmentsSection technicianId={technicianId} kind="job_type" plain />
          ) : null}
          {can("service_areas", "view") ? (
            <AssignmentsSection technicianId={technicianId} kind="service_area" plain />
          ) : null}

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
          <Button
            type="submit"
            variant="brand"
            disabled={update.isPending || updateUser.isPending}
            className="gap-1.5"
          >
            {update.isPending || updateUser.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
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

/**
 * The photo, put up from here — by the technician on their own card, or by a
 * manager. It is the `profile_photo` document underneath, so the Documents tab
 * lists it too; the buttons are drawn only for a viewer who may edit the card,
 * because a file input that answers with a 403 is worse than none.
 */
function ProfilePhotoField({
  technicianId,
  profile,
  user,
  editable,
}: {
  technicianId: string;
  profile: TechnicianProfile;
  user?: User;
  editable: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const busy = upload.isPending || remove.isPending;
  return (
    <div className="space-y-1.5">
      <Label>Profile picture</Label>
      <div className="flex items-center gap-4">
        <Avatar size="lg" className="size-16">
          {profile.profilePhotoUrl ? <AvatarImage src={profile.profilePhotoUrl} alt="" /> : null}
          <AvatarFallback className="text-lg">{initials(user?.firstName, user?.lastName)}</AvatarFallback>
        </Avatar>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate({ id: technicianId, file });
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {upload.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {profile.profilePhotoUrl ? "Change photo" : "Upload photo"}
            </Button>
            {profile.profilePhotoUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => remove.mutate({ id: technicianId })}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
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
