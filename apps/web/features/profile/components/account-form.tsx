"use client";

import { useId, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type { UpdateUserRequest, User } from "@bitcrm/types";
import { PhoneInput } from "@/components/ui/phone-input";
import { WzButton } from "@/components/workiz/button";
import { WzFormSectionTitle } from "@/components/workiz/form-section-title";
import { WzActionBar } from "@/components/workiz/layout";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { queryKeys } from "@/lib/query-keys";
import { formatDate } from "@/features/users/lib";
import { useUpdateMyPhone, useUpdateUser } from "@/features/users/hooks";
import { updateUserSchema, type UpdateUserValues } from "@/features/users/schemas";
import { SelfTwoFactor } from "./self-two-factor";

/** The label in a notched box's edge (FloatingLabel-module): 11px ink on white, 8px in, 8px up. */
const NOTCH =
  "pointer-events-none absolute -top-2 left-2 z-[1] bg-white px-1 text-[11px] leading-[normal] tracking-[0.4px] text-foreground";
/** Our phone control drawn as Workiz's outlined box: 40px, 1px #9ea6aa, 4px corners. */
const PHONE_BOX =
  "text-[13px] [&>div:first-child]:h-10 [&>div:first-child]:rounded-[4px] [&>div:first-child]:border-wz-outline [&>div:first-child]:shadow-none [&>div:first-child]:focus-within:border-wz-link [&>div:first-child]:focus-within:ring-0";

/** Whoever may edit users sets the name and the department; the phone is everyone's own. */
const phoneOnly = updateUserSchema.pick({ phone: true });

/**
 * My Profile for someone who is not a technician, on Workiz's user page
 * (pg_technicians_wz_10_user_profile): the same two 480px columns 44px apart,
 * 48px in, 33px under the tabs, and the yellow Save bar — what the account
 * holds, in Workiz's places.
 *
 * - Left, "User Details": the name (two boxes — the user record keeps the
 *   halves), Email (the sign-in, never changed here), ours Department, the
 *   Phone (always yours to set: it is the number telephony rings and the
 *   call log knows you by), and Two-factor authentication (the self-service
 *   row: a code texted and confirmed).
 * - Right, "Roles and permissions": the Role, read-only (it is assigned on
 *   the Users page, where the change is confirmed), and ours, when you joined.
 *
 * The name and the department are editable for whoever holds `users.edit`;
 * one Save sends the user record only what changed, and the phone only when
 * it changed.
 */
export function AccountForm({
  me,
  roleName,
  canEditUser,
  mfaRequired = false,
}: {
  me: User;
  roleName: string;
  canEditUser: boolean;
  /** Settings → Security Center requires two-factor authentication of everyone. */
  mfaRequired?: boolean;
}) {
  const qc = useQueryClient();
  const updateUser = useUpdateUser();
  const updatePhone = useUpdateMyPhone();
  const fieldId = useId();
  const id = (name: string) => `${fieldId}-${name}`;
  const schema = useMemo(() => (canEditUser ? updateUserSchema : phoneOnly), [canEditUser]);
  const form = useForm<UpdateUserValues>({
    resolver: zodResolver(schema as typeof updateUserSchema),
    defaultValues: {
      firstName: me.firstName,
      lastName: me.lastName,
      department: me.department ?? "",
      phone: me.phone ?? "",
    },
  });
  const { register, control, setValue, handleSubmit, formState } = form;
  const phone = useWatch({ control, name: "phone" }) ?? "";

  const onSubmit = (v: UpdateUserValues) => {
    if (canEditUser) {
      const person: UpdateUserRequest = {};
      if (v.firstName.trim() !== me.firstName) person.firstName = v.firstName.trim();
      if (v.lastName.trim() !== me.lastName) person.lastName = v.lastName.trim();
      if (v.department.trim() !== (me.department ?? "")) person.department = v.department.trim();
      if (Object.keys(person).length > 0) {
        updateUser.mutate(
          { id: me.id, body: person },
          // The page reads you from `me`, which the users list does not cover.
          { onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.me() }) },
        );
      }
    }
    const nextPhone = (v.phone ?? "").trim();
    if (nextPhone !== (me.phone ?? "")) updatePhone.mutate(nextPhone);
  };

  const saving = updateUser.isPending || updatePhone.isPending;
  const userRecordWhy = canEditUser ? undefined : id("user-record");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-x-11 gap-y-10 px-4 pt-[33px] pb-12 md:grid-cols-[minmax(0,480px)_minmax(0,480px)] md:px-12">
          {/* ---------------- The person ---------------- */}
          <div data-testid="person-column">
            <WzFormSectionTitle className="mb-6">User Details</WzFormSectionTitle>
            <div className="grid grid-cols-2 gap-5">
              <WzOutlinedTextField
                label="First name"
                disabled={!canEditUser}
                aria-describedby={userRecordWhy}
                error={formState.errors.firstName?.message}
                {...register("firstName")}
              />
              <WzOutlinedTextField
                label="Last name"
                disabled={!canEditUser}
                aria-describedby={userRecordWhy}
                error={formState.errors.lastName?.message}
                {...register("lastName")}
              />
            </div>
            <WzOutlinedTextField className="mt-6" label="Email" value={me.email} readOnly disabled aria-describedby={id("email-why")} />
            <span id={id("email-why")} className="sr-only">
              Your email is how you sign in, and can&apos;t be changed.
            </span>
            {/* Ours: the department the account belongs to. */}
            <WzOutlinedTextField
              className="mt-6"
              label="Department"
              disabled={!canEditUser}
              aria-describedby={userRecordWhy}
              error={formState.errors.department?.message}
              {...register("department")}
            />
            <span id={id("user-record")} className="sr-only">
              Your name and department are set by someone who may edit users.
            </span>

            {/* Workiz gives the country code a box of its own; ours is part of this control. */}
            <div className="relative mt-6">
              <label htmlFor={id("phone")} className={NOTCH}>
                Phone
              </label>
              <PhoneInput
                id={id("phone")}
                className={PHONE_BOX}
                value={phone}
                onChange={(next) => setValue("phone", next, { shouldValidate: true, shouldDirty: true })}
              />
              {formState.errors.phone?.message ? (
                <p className="mt-1 text-xs text-wz-error">{formState.errors.phone.message}</p>
              ) : (
                <p className="mt-1 text-[11px] leading-4 tracking-[0.4px] text-wz-outline-label">
                  The number we ring for your calls, and the one the call log knows you by.
                </p>
              )}
            </div>

            <SelfTwoFactor me={me} required={mfaRequired} className="mt-7" />
          </div>

          {/* ---------------- The role ---------------- */}
          <div data-testid="work-column">
            <WzFormSectionTitle className="mb-6">Roles and permissions</WzFormSectionTitle>
            <WzOutlinedTextField label="Role" value={roleName} readOnly disabled aria-describedby={id("role-why")} />
            <span id={id("role-why")} className="sr-only">
              Your role is assigned on the Users page.
            </span>
            <p className="mt-4 text-[13px] leading-[19px] tracking-[0.4px] text-wz-outline-label">
              Member since {formatDate(me.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Workiz's bar: white, its soft shadow, the yellow Save centred under both columns. */}
      <WzActionBar>
        <WzButton type="submit" className="min-w-[98px]" loading={saving}>
          Save
        </WzButton>
      </WzActionBar>
    </form>
  );
}
