"use client";

import { useId } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { WzButton } from "@/components/workiz/button";
import { WzCountryPhoneField } from "@/components/workiz/country-phone-field";
import { WzDrawer } from "@/components/workiz/drawer";
import { WzRadioButtons } from "@/components/workiz/radio-buttons";
import { WzSelect } from "@/components/workiz/select";
import { WzTextField } from "@/components/workiz/text-field";
import type { UserType } from "@bitcrm/types";
import { createUserSchema, toCreateUserRequest, type CreateUserValues } from "../schemas";
import { useCreateUser } from "../hooks";
import { useHierarchy } from "../use-can-manage";

/** Workiz's words: "User" (signs in, a paid seat) | "Subcontractor" (free, no sign-in). */
const USER_TYPE_OPTIONS = [
  { value: "regular", label: "User" },
  { value: "subcontractor", label: "Subcontractor" },
] as const;

/** Workiz's Yes / No selects ("Field tech", "Track Location"). */
const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/** Workiz's `small` under a box: 11px/13px #999, 10px down (subcontractor_wz_04_add_new_user). */
const HELPER = "mt-2.5 block text-[11px] leading-[13px] tracking-[0.4px] text-wz-caption";

/**
 * "+ Add New" on the Users and Technicians lists: Workiz's "Add team member"
 * pane (subcontractor_wz_04_add_new_user / _04b_add_new_subcontractor) — a
 * 400px panel under the grey band title, 20px in; the User | Subcontractor
 * switch with its caption; then the 48px floating-label boxes 15px apart:
 * Email Address (with "An invitation will be sent to this email"), Name,
 * "+1 | Phone"; for a User the react-selects Permission level ("What can
 * this user see and do on your account"), Field tech ("Can this user be
 * assigned to jobs") and Track Location, both opening on Yes as Workiz's;
 * ours last, Department. Cancel / "Invite user" (a User) or "Add user" (a
 * Subcontractor — no role, no invitation) in the 65px footer.
 *
 * One Name box, as Workiz: it is split on the first space into the first
 * and last name our record keeps (the New Job client name does the same).
 * Left out, no dead control: Workiz's Call masking toggle (ours is set on
 * the technician card afterwards — the create API has no such field) and
 * the schedule-colour brush beside Name (the card's too).
 */
export function CreateUserSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { assignableRoles, roles } = useHierarchy();
  const roleOptions = assignableRoles(roles);
  const mutation = useCreateUser();
  const formId = useId();

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      userType: "regular",
      name: "",
      email: "",
      phone: "",
      roleId: "",
      fieldTeamMember: true,
      gpsTrackingEnabled: true,
      department: "",
    },
  });
  const errors = form.formState.errors;
  const userType = useWatch({ control: form.control, name: "userType" }) ?? "regular";
  const subcontractor = userType === "subcontractor";

  const onSubmit = (values: CreateUserValues) =>
    mutation.mutate(toCreateUserRequest(values), {
      onSuccess: () => {
        form.reset();
        onOpenChange(false);
      },
    });

  return (
    <WzDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Add team member"
      head="band"
      width={400}
      bodyClassName="px-5 pt-7 pb-6"
      footerClassName="gap-4 px-5 pt-[15px] shadow-[0_0_5px_rgba(50,50,50,0.2)]"
      onInteractOutside={(e) => {
        // A role or country list sits in a portal; picking from it is not a click outside.
        if ((e.target as Element | null)?.closest("[data-wz-combobox-root],[role=listbox]")) e.preventDefault();
      }}
      footer={
        <>
          <WzButton variant="tertiary" size="regular" onClick={() => onOpenChange(false)}>
            Cancel
          </WzButton>
          <WzButton type="submit" form={formId} variant="primary" size="regular" loading={mutation.isPending}>
            {subcontractor ? "Add user" : "Invite user"}
          </WzButton>
        </>
      }
    >
      <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-[15px]" noValidate>
        <div>
          <WzRadioButtons<UserType>
            aria-label="User type"
            aria-describedby="create-user-type-help"
            options={USER_TYPE_OPTIONS}
            value={userType}
            onChange={(v) => form.setValue("userType", v, { shouldValidate: false })}
          />
          <small id="create-user-type-help" className={HELPER}>
            {subcontractor ? "Can not login, can take jobs and get messages" : "Can login and work on your account"}
          </small>
        </div>

        <div>
          <WzTextField label="Email Address" type="email" autoComplete="off" error={errors.email?.message} {...form.register("email")} />
          {/* Workiz says "An invitation will be sent to this email" to a subcontractor
              too; we send none — there is no sign-in to invite them to. */}
          <small className={HELPER}>
            {subcontractor ? "No sign-in: job details reach them by text or email." : "An invitation will be sent to this email"}
          </small>
        </div>

        <WzTextField label="Name" autoComplete="off" error={errors.name?.message} {...form.register("name")} />

        <Controller
          control={form.control}
          name="phone"
          render={({ field }) => (
            <WzCountryPhoneField value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur} error={errors.phone?.message} />
          )}
        />

        {/* Workiz's "Call masking" toggle stands here (subcontractor_wz_04_add_new_user:
            the 40×20 switch at y377, 65px from Phone's foot to the next box).
            Masking is set on the technician card afterwards — the create API has
            no such field — so the row's room stays (35px + the two 15px gaps) and
            the switch does not: the boxes under it keep Workiz's y. */}
        <div aria-hidden data-slot="call-masking-space" className="h-[35px] shrink-0" />

        {subcontractor ? null : (
          <>
            <div>
              <Controller
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <WzSelect
                    label="Permission level"
                    options={roleOptions.map((r) => ({ value: r.id, label: r.name }))}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={errors.roleId?.message}
                  />
                )}
              />
              <small className={HELPER}>What can this user see and do on your account</small>
            </div>
            <div>
              <Controller
                control={form.control}
                name="fieldTeamMember"
                render={({ field }) => (
                  <WzSelect
                    label="Field tech"
                    options={YES_NO}
                    searchable={false}
                    value={field.value === false ? "no" : "yes"}
                    onChange={(v) => field.onChange(v === "yes")}
                    onBlur={field.onBlur}
                  />
                )}
              />
              <small className={HELPER}>Can this user be assigned to jobs</small>
            </div>
            <Controller
              control={form.control}
              name="gpsTrackingEnabled"
              render={({ field }) => (
                <WzSelect
                  label="Track Location"
                  options={YES_NO}
                  searchable={false}
                  value={field.value === false ? "no" : "yes"}
                  onChange={(v) => field.onChange(v === "yes")}
                  onBlur={field.onBlur}
                />
              )}
            />
          </>
        )}

        {/* Ours: Workiz has no department; it stays, last. */}
        <WzTextField label="Department" autoComplete="off" error={errors.department?.message} {...form.register("department")} />
      </form>
    </WzDrawer>
  );
}
