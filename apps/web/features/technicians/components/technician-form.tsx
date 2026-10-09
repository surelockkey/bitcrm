"use client";

import { useId, useRef, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneInput } from "@/components/ui/phone-input";
import { WzButton, WzLink } from "@/components/workiz/button";
import { WzFormSectionTitle, WzInfoTip } from "@/components/workiz/form-section-title";
import { WzActionBar } from "@/components/workiz/layout";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzTimeSelect } from "@/components/workiz/outlined";
import { WzMiniToggle } from "@/components/workiz/switch-tabs";
import { WzCheckbox } from "@/components/workiz/toggles";
import type { TechnicianProfile, TechnicianProfileStatus, TechnicianType, UpdateUserRequest, User } from "@bitcrm/types";
import { isFieldTeamMember } from "@bitcrm/types";
import { AddressAutocomplete } from "@/features/deals/components/address-autocomplete";
import { usePermissions } from "@/features/auth/use-permissions";
import { initials } from "@/features/users/lib";
import { useSetUserMfa, useUpdateUser } from "@/features/users/hooks";
import { cn } from "@/lib/utils";
import { useDeletePhoto, useProfile, useUpdateProfile, useUploadPhoto } from "../hooks";
import type { UpdateProfileBody } from "../api";
import { profileSchema, type ProfileValues } from "../schemas";
import { useSetClientNumberVisibility } from "../masking-hooks";
import type { TechnicianEditRights } from "../lib";
import { TEAM_TYPE_LABEL } from "../team-list";
import { AssignmentsSection } from "./assignments-section";
import { OnboardingSection } from "./onboarding-section";
import { ScheduleColorField } from "./schedule-color-field";

/** Said, to whoever cannot see that a control is greyed, why it is. */
const MANAGER_ONLY = "A manager sets this.";
const NOT_YOURS = "You can read this technician's details but not change them.";
/** The name, the field-team switch and two-step sign-in: the user record's, behind `users.edit`. */
const ON_USER_RECORD = "Set on the user record, by someone who may edit users.";
const MAX_ADDITIONAL_PHONES = 5;

/** The days Workiz's week starts from, Monday first, as the schedule shows them. */
const DAYS = [
  { i: 1, label: "Mon" },
  { i: 2, label: "Tue" },
  { i: 3, label: "Wed" },
  { i: 4, label: "Thu" },
  { i: 5, label: "Fri" },
  { i: 6, label: "Sat" },
  { i: 0, label: "Sun" },
];
/** Where the hours start before anyone set them: Mon–Fri, 08:00–17:00. Saved only once touched. */
const DEFAULT_DAYS = [1, 2, 3, 4, 5];

export type TechnicianFormTab = "profile" | "availability";

/** Profile type, Workiz's words: our regular technician is Workiz's "User". */
const TYPE_OPTIONS = (Object.keys(TEAM_TYPE_LABEL) as TechnicianType[]).map((t) => ({ value: t, label: TEAM_TYPE_LABEL[t] }));
const STATUS_OPTIONS: { value: TechnicianProfileStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/**
 * The card's form, laid out as Workiz's user page (`/root/editUser/<id>`,
 * pg_technicians_wz_10_user_profile; numbers in
 * pg_technicians_wz_measure_user.json): two 480px columns 44px apart, 48px
 * in, 36px under the tabs.
 *
 * - Left: the round picture with "Profile picture", ☐ Track location, then
 *   "User Details" — User type, the name, Email, Home address, Phone,
 *   Additional phone numbers — and the Call masking / Two-factor switches.
 * - Right: "Roles and permissions" (☑ Field team member; the role itself is
 *   the user record's, the owner struck it here), Labor cost per hour, Job
 *   types ("User skills"), Service areas, Schedule color — then ours, which
 *   Workiz has no place for: the technician's status, the mobile app and the
 *   onboarding checklist, under a title of their own.
 *
 * The Availability tab's hours are part of the same form, as in Workiz, where
 * one Save at the foot of the page saves every tab. Workiz's Notes, user
 * signature, sync email, allowed IPs and notification switches have no data
 * behind them here and are left out, not drawn dead.
 *
 * Editing follows the API's own split rather than one permission: contact
 * details are the technician's own, operational fields are a manager's, and
 * the name, the field-team switch and two-step sign-in are the user record's
 * — see `technicianEditRights`. One Save writes both records, each with only
 * what its viewer may set and, for the user record, only what changed.
 */
export function TechnicianForm({
  technicianId,
  user,
  rights,
  tab = "profile",
  twoFactor,
}: {
  technicianId: string;
  user?: User;
  rights: TechnicianEditRights;
  tab?: TechnicianFormTab;
  /**
   * Drawn in place of the "Two-factor authentication" switch row — My
   * Profile's own sign-in flow (a code texted and confirmed), where the
   * switch a manager flips for someone else would be greyed out.
   */
  twoFactor?: ReactNode;
}) {
  const { data: profile, isLoading } = useProfile(technicianId);
  if (isLoading || !profile) {
    return (
      <div className="grid grid-cols-2 gap-x-11 px-12 pt-9">
        <Skeleton className="h-[28rem] w-full" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    );
  }
  return (
    <Form key={profile.updatedAt} technicianId={technicianId} profile={profile} user={user} rights={rights} tab={tab} twoFactor={twoFactor} />
  );
}

function Form({
  technicianId,
  profile,
  user,
  rights,
  tab,
  twoFactor,
}: {
  technicianId: string;
  profile: TechnicianProfile;
  user?: User;
  rights: TechnicianEditRights;
  tab: TechnicianFormTab;
  twoFactor?: ReactNode;
}) {
  const { can } = usePermissions();
  const update = useUpdateProfile();
  const updateUser = useUpdateUser();
  const setMfa = useSetUserMfa();
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
      workingDays: profile.workingDays ?? DEFAULT_DAYS,
      workStart: profile.workStart ?? "08:00",
      workEnd: profile.workEnd ?? "17:00",
    },
  });
  const { register, control, setValue, handleSubmit, formState } = form;
  const setMasking = useSetClientNumberVisibility();
  const status = useWatch({ control, name: "status" });
  const technicianType = useWatch({ control, name: "technicianType" });
  const fieldTeamMember = useWatch({ control, name: "fieldTeamMember" });
  const callMasking = useWatch({ control, name: "callMaskingEnabled" });
  const gps = useWatch({ control, name: "gpsTrackingEnabled" });
  const mobile = useWatch({ control, name: "mobileAppInstalled" });
  const phone = useWatch({ control, name: "phone" }) ?? "";
  const additionalPhones = useWatch({ control, name: "additionalPhones" }) ?? [];
  const line1 = useWatch({ control, name: "line1" }) ?? "";
  const workingDays = useWatch({ control, name: "workingDays" }) ?? DEFAULT_DAYS;
  const workStart = useWatch({ control, name: "workStart" }) ?? "08:00";
  const workEnd = useWatch({ control, name: "workEnd" }) ?? "17:00";

  const canSave = rights.contact || rights.operational || rights.identity;
  const contactWhy = rights.contact ? undefined : NOT_YOURS;
  const workWhy = rights.operational ? undefined : MANAGER_ONLY;
  const identityWhy = rights.identity ? undefined : ON_USER_RECORD;
  const twoFactorOn = !!user?.smsMfaEnabled;

  const setAdditionalPhones = (next: string[]) => setValue("additionalPhones", next, { shouldDirty: true });

  /** The hours as they opened; they go out only when they differ — a default is not a choice. */
  const hoursChanged = (v: ProfileValues) => {
    const was = form.formState.defaultValues;
    return (
      (v.workingDays ?? []).join(",") !== (was?.workingDays ?? []).join(",") ||
      v.workStart !== was?.workStart ||
      v.workEnd !== was?.workEnd
    );
  };

  /**
   * Only what this viewer may set goes into each body. The API refuses the
   * WHOLE profile update when an operational field is present and the caller
   * is not a manager, so a technician saving their own address must not carry
   * their (unchanged) labor cost along with it. The hours go only once they
   * were touched — unset hours dim nothing, and a default is not a choice. The
   * user record gets only what changed: it is a different record, and an
   * untouched one stays so.
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
      if (hoursChanged(v)) {
        body.workingDays = v.workingDays;
        body.workStart = v.workStart;
        body.workEnd = v.workEnd;
      }
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

  const saving = update.isPending || updateUser.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ---------------- Profile ---------------- */}
        <div hidden={tab !== "profile"} data-testid="profile-panel">
          <div className="grid grid-cols-[minmax(0,480px)_minmax(0,480px)] gap-x-11 px-12 pt-[33px] pb-12">
            {/* ---------------- The person ---------------- */}
            <div data-testid="person-column">
              <ProfilePhotoField technicianId={technicianId} profile={profile} user={user} editable={rights.contact} />

              <div className="mt-[21px] flex items-center">
                <WzCheckbox
                  label="Track location"
                  checked={gps}
                  disabled={!rights.operational}
                  aria-describedby={id("gps-why")}
                  onCheckedChange={(c) => setValue("gpsTrackingEnabled", c, { shouldDirty: true })}
                />
                <WzInfoTip id={id("gps-why")} label="Track location" text={workWhy ?? "Their position during shifts, on the dispatch map."} />
              </div>

              <WzFormSectionTitle className="mt-[33px] mb-6">User Details</WzFormSectionTitle>

              {/* Workiz's "User type". A subcontractor is paid and insured
                  differently from an employee — a manager's to set. */}
              <WzOutlinedSelect
                label="User type"
                options={TYPE_OPTIONS}
                value={technicianType}
                disabled={!rights.operational}
                aria-describedby={workWhy ? id("work-why") : undefined}
                onChange={(v) => setValue("technicianType", v as TechnicianType, { shouldDirty: true })}
              />

              {/* Workiz has one "Name"; the user record keeps the two halves
                  apart, so they are two boxes on its line. */}
              <div className="mt-6 grid grid-cols-2 gap-5">
                <WzOutlinedTextField
                  label="First name"
                  disabled={!rights.identity}
                  aria-describedby={rights.identity ? undefined : id("user-record")}
                  {...register("firstName")}
                />
                <WzOutlinedTextField
                  label="Last name"
                  disabled={!rights.identity}
                  aria-describedby={rights.identity ? undefined : id("user-record")}
                  {...register("lastName")}
                />
              </div>

              <WzOutlinedTextField
                className="mt-6"
                label="Email"
                value={user?.email ?? ""}
                readOnly
                disabled
                aria-describedby={id("user-record")}
              />
              <span id={id("user-record")} className="sr-only">
                {rights.identity
                  ? "The email is the sign-in and can't be changed."
                  : "Name and email live on the user record; the email is the sign-in and can't be changed."}
              </span>

              {/* Workiz's one "Home address" box; ours keeps the pieces the
                  dispatch map geocodes, the autocomplete first, the rest in a
                  row under it. */}
              <div className="mt-6">
                <div className="relative">
                  <span aria-hidden className={NOTCH}>
                    Home address
                  </span>
                  {rights.contact ? (
                    <AddressAutocomplete
                      id={id("line1")}
                      ariaLabel="Home address"
                      placeholder="Street address"
                      className={OUTLINED_INPUT}
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
                    <WzOutlinedTextField aria-label="Home address" disabled aria-describedby={id("contact-why")} {...register("line1")} />
                  )}
                </div>
                <div className="mt-2.5 grid grid-cols-[1fr_1.4fr_0.8fr_0.9fr] gap-2.5">
                  <WzOutlinedTextField label="Apt, suite" disabled={!rights.contact} aria-describedby={contactWhy ? id("contact-why") : undefined} {...register("line2")} />
                  <WzOutlinedTextField label="City" disabled={!rights.contact} aria-describedby={contactWhy ? id("contact-why") : undefined} {...register("city")} />
                  <WzOutlinedTextField label="State" disabled={!rights.contact} aria-describedby={contactWhy ? id("contact-why") : undefined} {...register("state")} />
                  <WzOutlinedTextField label="ZIP" disabled={!rights.contact} aria-describedby={contactWhy ? id("contact-why") : undefined} {...register("zip")} />
                </div>
              </div>

              {/* Workiz gives the country code a box of its own; ours is part
                  of this control. Saved onto the user record — the number
                  telephony rings and the call log matches. */}
              <div className="relative mt-6">
                <label htmlFor={id("phone")} className={NOTCH}>
                  Phone
                </label>
                <PhoneInput
                  id={id("phone")}
                  className={PHONE_BOX}
                  disabled={!rights.contact}
                  value={phone}
                  onChange={(v) => setValue("phone", v, { shouldValidate: true, shouldDirty: true })}
                />
                {formState.errors.phone?.message ? <p className="mt-1 text-xs text-wz-error">{formState.errors.phone.message}</p> : null}
              </div>

              {/* Workiz's "Additional phone numbers": numbers beside the one
                  telephony rings, kept on the technician record. */}
              <div role="group" aria-label="Additional phone numbers" className="mt-6 space-y-2.5">
                {additionalPhones.map((value, i) => (
                  <div key={i} className="relative flex items-center gap-2">
                    <label htmlFor={id(`additional-${i}`)} className={NOTCH}>
                      Additional phone {i + 1}
                    </label>
                    <PhoneInput
                      id={id(`additional-${i}`)}
                      className={cn(PHONE_BOX, "flex-1")}
                      disabled={!rights.contact}
                      value={value}
                      onChange={(v) => setAdditionalPhones(additionalPhones.map((p, j) => (j === i ? v : p)))}
                    />
                    <button
                      type="button"
                      aria-label={`Remove additional phone ${i + 1}`}
                      disabled={!rights.contact}
                      onClick={() => setAdditionalPhones(additionalPhones.filter((_, j) => j !== i))}
                      className="grid size-8 shrink-0 place-items-center rounded-full text-foreground hover:bg-wz-secondary-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                {additionalPhones.length < MAX_ADDITIONAL_PHONES ? (
                  <button
                    type="button"
                    disabled={!rights.contact}
                    onClick={() => setAdditionalPhones([...additionalPhones, ""])}
                    aria-describedby={contactWhy ? id("contact-why") : undefined}
                    className="flex h-[42px] w-full items-center justify-between rounded-[4px] border border-wz-outline bg-white pr-[9px] pl-3 text-left text-[13px] tracking-[0.4px] text-wz-outline-label outline-none hover:border-foreground focus-visible:border-wz-link disabled:cursor-not-allowed disabled:border-wz-outline-disabled"
                  >
                    {additionalPhones.length ? "Add another phone number" : "Additional phone numbers"}
                    <Plus className="size-4 text-foreground" strokeWidth={1.75} />
                  </button>
                ) : null}
              </div>
              <span id={id("contact-why")} className="sr-only">
                {NOT_YOURS}
              </span>

              {/* "Call masking": they see the client's name and call through
                  the system, never the number. It writes through the
                  permission that governs this, at once, so there is only one
                  switch for one behaviour. */}
              <SwitchRow
                className="mt-7"
                label="Call masking"
                info={workWhy ?? "They see the client's name and call through the system, never the number."}
                tipId={id("masking-why")}
                checked={callMasking}
                disabled={!rights.operational || setMasking.isPending}
                onChange={(c) => {
                  setValue("callMaskingEnabled", c, { shouldDirty: true });
                  setMasking.mutate({ userId: technicianId, hideNumbers: c });
                }}
              />
              {/* Two-step sign-in: the user record's, switched at once as on
                  the Users page. On needs a phone on the card — their next
                  sign-in texts it. My Profile brings its own row instead. */}
              {twoFactor ? (
                <div className="mt-6">{twoFactor}</div>
              ) : (
                <SwitchRow
                  className="mt-6"
                  label="Two-factor authentication"
                  info={identityWhy ?? "After the password, a code is texted to their phone. Turning it on needs a phone on the card."}
                  tipId={id("mfa-why")}
                  checked={twoFactorOn}
                  disabled={!rights.identity || !user || setMfa.isPending}
                  onChange={(c) => setMfa.mutate({ id: technicianId, enabled: c })}
                />
              )}
            </div>

            {/* ---------------- The work ---------------- */}
            <div data-testid="work-column">
              <WzFormSectionTitle className="mb-6">Roles and permissions</WzFormSectionTitle>
              {/* The one switch that decides who may be put on a job, whatever
                  the role. The role itself is not on this card: it is
                  assigned on the user record, where the change is confirmed. */}
              <div className="flex items-center">
                <WzCheckbox
                  label="Field team member"
                  checked={fieldTeamMember}
                  disabled={!rights.identity}
                  aria-describedby={id("field-team-why")}
                  onCheckedChange={(c) => setValue("fieldTeamMember", c, { shouldDirty: true })}
                />
                <WzInfoTip id={id("field-team-why")} label="Field team member" text={identityWhy ?? "Goes out on jobs, and can be put on one."} />
              </div>

              <WzFormSectionTitle className="mt-10" info="What an hour of their work costs the business.">
                Labor cost per hour
              </WzFormSectionTitle>
              {/* InputWithSymbol: a 120px box, the "$" in a 40px #f3f6f7 cell at its right. */}
              <div className="relative mt-[13px] w-[120px]">
                <WzOutlinedTextField
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="00.00"
                  aria-label="Labor cost per hour"
                  inputClassName="pr-12 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  disabled={!rights.operational}
                  aria-describedby={workWhy ? id("work-why") : undefined}
                  error={formState.errors.laborCostPerHour?.message}
                  {...register("laborCostPerHour")}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-0 right-0 grid h-10 w-10 place-items-center rounded-r-[4px] border border-wz-outline bg-wz-secondary-hover text-sm leading-[21px] font-medium text-wz-outline-label"
                >
                  $
                </span>
              </div>

              {can("job_types", "view") ? (
                <>
                  <WzFormSectionTitle className="mt-[30px]" info="What they can do — the jobs they may be put on.">
                    Job types
                  </WzFormSectionTitle>
                  <div className="mt-[37px]">
                    <AssignmentsSection technicianId={technicianId} kind="job_type" />
                  </div>
                </>
              ) : null}
              {can("service_areas", "view") ? (
                <>
                  <WzFormSectionTitle className="mt-10" info="Where they work.">
                    Service areas
                  </WzFormSectionTitle>
                  <div className="mt-[35px]">
                    <AssignmentsSection technicianId={technicianId} kind="service_area" />
                  </div>
                </>
              ) : null}

              <WzFormSectionTitle className="mt-[22px] mb-4">Schedule color</WzFormSectionTitle>
              <ScheduleColorField disabled={!rights.operational} />

              {/* Ours, not Workiz's — kept together under a title of their
                  own rather than slipped into Workiz's order. */}
              <WzFormSectionTitle className="mt-8 mb-6">Technician status</WzFormSectionTitle>
              <WzOutlinedSelect
                label="Status"
                options={STATUS_OPTIONS}
                value={status}
                disabled={!rights.operational}
                aria-describedby={workWhy ? id("work-why") : undefined}
                onChange={(v) => setValue("status", v as TechnicianProfileStatus, { shouldDirty: true })}
              />
              <div className="mt-4">
                <WzCheckbox
                  label="Mobile app installed"
                  checked={mobile}
                  disabled={!rights.operational}
                  aria-describedby={workWhy ? id("work-why") : undefined}
                  onCheckedChange={(c) => setValue("mobileAppInstalled", c, { shouldDirty: true })}
                />
              </div>
              <div className="mt-6">
                <OnboardingSection technicianId={technicianId} />
              </div>
              <span id={id("work-why")} className="sr-only">
                {MANAGER_ONLY}
              </span>
            </div>
          </div>
        </div>

        {/* ---------------- Availability ---------------- */}
        <div hidden={tab !== "availability"} data-testid="availability-panel" className="px-12 pt-[33px] pb-12">
          <WzFormSectionTitle>User availability</WzFormSectionTitle>
          <p className="mt-1 text-[13px] leading-[19px] tracking-[0.4px] text-foreground">Set your users work hours</p>
          <div role="group" aria-label="Working days" className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            {DAYS.map((d) => (
              <WzCheckbox
                key={d.i}
                label={d.label}
                checked={workingDays.includes(d.i)}
                disabled={!rights.operational}
                aria-describedby={workWhy ? id("work-why") : undefined}
                onCheckedChange={(on) =>
                  setValue(
                    "workingDays",
                    on ? [...workingDays, d.i].sort((x, y) => x - y) : workingDays.filter((x) => x !== d.i),
                    { shouldDirty: true },
                  )
                }
              />
            ))}
          </div>
          <div className="mt-6 grid w-[454px] max-w-full grid-cols-2 gap-5">
            <WzTimeSelect
              label="From"
              value={workStart}
              disabled={!rights.operational}
              onChange={(v) => setValue("workStart", v, { shouldDirty: true, shouldValidate: true })}
            />
            <WzTimeSelect
              label="To"
              value={workEnd}
              disabled={!rights.operational}
              error={formState.errors.workEnd?.message}
              onChange={(v) => setValue("workEnd", v, { shouldDirty: true, shouldValidate: true })}
            />
          </div>
        </div>
      </div>

      {canSave ? (
        // Workiz's bar: white, its soft shadow, the yellow Save centred under
        // both columns; the fields above own the scroll, the bar never moves.
        <WzActionBar>
          <WzButton type="submit" className="min-w-[98px]" loading={saving}>
            Save
          </WzButton>
          {!rights.operational ? (
            <span className="text-xs text-wz-outline-label">Greyed fields are set by a manager.</span>
          ) : null}
        </WzActionBar>
      ) : (
        <WzActionBar>
          <span className="text-xs text-wz-outline-label">You can read this card but not change it.</span>
        </WzActionBar>
      )}
    </form>
  );
}

/** The label in a notched box's edge (FloatingLabel-module): 11px ink on white, 8px in, 8px up. */
const NOTCH =
  "pointer-events-none absolute -top-2 left-2 z-[1] bg-white px-1 text-[11px] leading-[normal] tracking-[0.4px] text-foreground";
/** The address autocomplete's input as Workiz's 40px outlined box. */
const OUTLINED_INPUT =
  "h-10 rounded-[4px] border-wz-outline text-[13px] tracking-[0.4px] shadow-none hover:border-foreground focus-visible:border-wz-link focus-visible:ring-0";
/** Our phone control drawn as Workiz's outlined box: 40px, 1px #9ea6aa, 4px corners. */
const PHONE_BOX =
  "text-[13px] [&>div:first-child]:h-10 [&>div:first-child]:rounded-[4px] [&>div:first-child]:border-wz-outline [&>div:first-child]:shadow-none [&>div:first-child]:focus-within:border-wz-link [&>div:first-child]:focus-within:ring-0";

/**
 * A switch row as on the user page (Call masking, Two-factor): 14px/16px
 * #404040 words, an ⓘ 4px after them, the 32×16 Toggle-module switch at the
 * column's right edge.
 */
function SwitchRow({
  label,
  info,
  tipId,
  checked,
  disabled,
  onChange,
  className,
}: {
  label: string;
  info: ReactNode;
  tipId: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (c: boolean) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="flex items-center text-sm leading-4 tracking-[0.4px] text-wz-strong">
        {label}
        <WzInfoTip id={tipId} label={label} text={info} />
      </span>
      <WzMiniToggle label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-describedby={tipId} />
    </div>
  );
}

/**
 * The picture, as Workiz's imageUploader: a 104px disc — the photo, or ink
 * with "Upload Image" — with a 26px yellow "+" at its foot, "Profile picture"
 * beside it. It is the `profile_photo` document underneath, so the Documents
 * tab lists it too; the disc takes a click only from a viewer who may edit
 * the card, because a file input that answers with a 403 is worse than none.
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
  const photo = profile.profilePhotoUrl;

  const disc = (
    <span className="relative block size-[104px] shrink-0">
      <span className="grid size-[104px] place-items-center overflow-hidden rounded-full bg-foreground text-center text-[13px] leading-[19px] font-semibold text-white">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a build-time asset
          <img src={photo} alt="" className="size-full object-cover" />
        ) : editable ? (
          <span className="px-4">Upload Image</span>
        ) : (
          <span className="text-2xl">{initials(user?.firstName, user?.lastName)}</span>
        )}
      </span>
      {editable ? (
        <span className="absolute right-0 bottom-[9px] grid size-[26px] place-items-center rounded-full border border-white bg-primary text-foreground">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-4" strokeWidth={2.5} />}
        </span>
      ) : null}
    </span>
  );

  return (
    <div className="flex items-center gap-4">
      {editable ? (
        <>
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
          <button
            type="button"
            aria-label={photo ? "Change photo" : "Upload photo"}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-wait"
          >
            {disc}
          </button>
        </>
      ) : (
        disc
      )}
      <div>
        <div className="text-sm leading-[21px] font-semibold tracking-[0.4px] text-foreground">Profile picture</div>
        <small className="block text-[11px] leading-4 font-medium tracking-[0.4px] text-foreground">PNG, JPEG or WebP image</small>
        {editable && photo ? (
          <WzLink tone="underlined" className="mt-1" disabled={busy} onClick={() => remove.mutate({ id: technicianId })}>
            Remove photo
          </WzLink>
        ) : null}
      </div>
    </div>
  );
}
