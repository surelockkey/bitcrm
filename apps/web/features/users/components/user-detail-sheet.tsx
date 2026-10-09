"use client";

import { useState } from "react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WzButton } from "@/components/workiz/button";
import { WzFormSectionTitle } from "@/components/workiz/form-section-title";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzPopMenu, type WzPopMenuItem } from "@/components/workiz/pop-menu";
import { WzTabBar } from "@/components/workiz/tab-bar";
import { WzCheckbox } from "@/components/workiz/toggles";
import type { User } from "@bitcrm/types";
import { UserStatus, isFieldTeamMember } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { personName } from "@/features/deals/person-name";
import { formatTeamCreated } from "@/features/technicians/team-list";
import { updateUserSchema, type UpdateUserValues } from "../schemas";
import { useAssignRole, useDeactivateUser, useReactivateUser, useResendInvite, useUpdateUser } from "../hooks";
import { useHierarchy } from "../use-can-manage";
import { roleName } from "../lib";
import { UserPermissionsSummary } from "./user-permissions-summary";
import { UserTwoStepSwitch } from "./user-two-step-switch";

/** The Team grid's `tag small` chip: 11px/13px 500 white on its colour, 3px corners. */
const CHIP = "rounded-[3px] px-1 py-px text-[11px] leading-[13px] font-medium tracking-[0.4px] text-white";

/**
 * A user's card, opened from the Users list — in the words and boxes of
 * Workiz's user page (`/root/editUser/<id>`, pg_technicians_wz_10_user_profile):
 * the name with "Actions ⌄" (ours: Resend invite / Deactivate / Reactivate),
 * small tabs, "User Details" in outlined boxes, "Field team member" as
 * Workiz's checkbox, "Roles and permissions" with the Role box and
 * "Customize roles and permissions here". Ours, kept: the drawer itself (the
 * list stays behind it), Department, the two-step switch, the per-user
 * permissions tab and the activity dates.
 */
export function UserDetailSheet({
  user,
  defaultTab = "profile",
  onClose,
}: {
  user: User;
  defaultTab?: string;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const { roles, canManage, canEditProfile, assignableRoles } = useHierarchy();
  const manageable = canManage(user);

  const updateUser = useUpdateUser();
  const assignRole = useAssignRole();
  const resendInvite = useResendInvite();
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();

  const [tab, setTab] = useState(defaultTab);
  const [pendingRole, setPendingRole] = useState(user.roleId);
  const [confirmRole, setConfirmRole] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const form = useForm<UpdateUserValues>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      department: user.department,
      phone: user.phone ?? "",
      // Unset on a record from before the switch: a technician is on the field
      // team until switched off, and nobody else is until switched on.
      fieldTeamMember: isFieldTeamMember(user),
    },
  });
  const errors = form.formState.errors;

  const canEdit = can("users", "edit") && manageable;
  // The profile tab alone: your own card as well as those below you.
  const canEditProfileTab = can("users", "edit") && canEditProfile(user);
  const isActive = user.status === UserStatus.ACTIVE;
  const role = roleName(user.roleId, roles);

  const actions: WzPopMenuItem[] = [
    ...(can("users", "create") ? [{ key: "resend", label: "Resend invite", onSelect: () => resendInvite.mutate(user.id) }] : []),
    ...(isActive
      ? can("users", "delete") && manageable
        ? [{ key: "deactivate", label: "Deactivate", onSelect: () => setConfirmDeactivate(true) }]
        : []
      : can("users", "edit") && manageable
        ? [{ key: "reactivate", label: "Reactivate", onSelect: () => reactivate.mutate(user.id) }]
        : []),
  ];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        onInteractOutside={(e) => {
          // Selects/menus render in a portal outside the sheet; dismissing one
          // must not be treated as an outside-click that closes the sheet too.
          const target = e.target as Element | null;
          if (
            target?.closest(
              '[data-slot="select-content"],[data-radix-popper-content-wrapper],[role="listbox"],[role="menu"],[data-wz-combobox-root]',
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <SheetHeader className="gap-0 px-6 pt-6 pb-4">
          <div className="flex items-start gap-4 pr-8">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">{personName(user) ?? user.email}</SheetTitle>
              <div className="mt-[5px] truncate text-xs leading-4 text-wz-caption">{user.email}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className={`${CHIP} bg-wz-link`}>{role}</span>
                {!isActive ? <span className={`${CHIP} bg-wz-outline`}>Inactive</span> : null}
                {user.department ? (
                  <span className="ml-1 text-xs leading-4 text-wz-outline-label">{user.department}</span>
                ) : null}
              </div>
            </div>
            {actions.length ? <WzPopMenu items={actions} /> : null}
          </div>
        </SheetHeader>

        <WzTabBar
          aria-label="User"
          className="px-1"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "profile", label: "Profile" },
            { value: "role", label: "Role & access" },
            { value: "permissions", label: "Permissions" },
            { value: "activity", label: "Activity" },
          ]}
        />

        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-6">
          {tab === "profile" ? (
            <form
              onSubmit={form.handleSubmit((v) => updateUser.mutate({ id: user.id, body: v }))}
              className="flex flex-col gap-6"
              noValidate
            >
              <WzFormSectionTitle>User Details</WzFormSectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <WzOutlinedTextField
                  label="First name"
                  disabled={!canEditProfileTab}
                  error={errors.firstName?.message}
                  {...form.register("firstName")}
                />
                <WzOutlinedTextField
                  label="Last name"
                  disabled={!canEditProfileTab}
                  error={errors.lastName?.message}
                  {...form.register("lastName")}
                />
              </div>
              <div>
                <WzOutlinedTextField label="Email" value={user.email} readOnly disabled />
                <p className="mt-1 pl-3 text-xs leading-[18px] text-wz-outline-label">Email can&apos;t be changed.</p>
              </div>
              <WzOutlinedTextField
                label="Department"
                disabled={!canEditProfileTab}
                error={errors.department?.message}
                {...form.register("department")}
              />
              <div>
                <label htmlFor={`phone-${user.id}`} className="mb-1.5 block text-[13px] leading-[19px] font-medium text-foreground">
                  Phone
                </label>
                <Controller
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <PhoneInput
                      id={`phone-${user.id}`}
                      className="h-10"
                      disabled={!canEditProfileTab}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
                <p className="mt-1 pl-3 text-xs leading-[18px] text-wz-outline-label">
                  Their own number — calls to or from it are attributed to them in the call log.
                </p>
                {errors.phone?.message ? <p className="mt-1 pl-3 text-xs text-wz-error">{errors.phone.message}</p> : null}
              </div>
              {/* Workiz's "Field team member", for everyone: the owner who
                  still does calls is on the field team; a technician who
                  moved into the office is not. Switching it on opens their
                  technician card. */}
              <div>
                <Controller
                  control={form.control}
                  name="fieldTeamMember"
                  render={({ field }) => (
                    <WzCheckbox
                      label="Field team member"
                      checked={field.value ?? false}
                      disabled={!canEditProfileTab}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
                <p className="mt-1 pl-[28px] text-xs leading-[18px] text-wz-outline-label">
                  Goes out on jobs and can be put on one, whatever their role.
                </p>
              </div>
              {/* Saves on its own: an admin switching off a lost phone should
                  not have to save the rest of the profile to do it. */}
              <UserTwoStepSwitch user={user} canEdit={canEditProfileTab} />
              {canEditProfileTab ? (
                <div className="flex justify-end">
                  <WzButton type="submit" variant="primary" size="big" loading={updateUser.isPending} className="min-w-[150px]">
                    Save
                  </WzButton>
                </div>
              ) : null}
            </form>
          ) : null}

          {tab === "role" ? (
            <div className="flex flex-col gap-6">
              <WzFormSectionTitle>Roles and permissions</WzFormSectionTitle>
              {canEdit ? (
                <div>
                  <WzOutlinedSelect
                    label="Role"
                    options={assignableRoles(roles).map((r) => ({ value: r.id, label: r.name }))}
                    value={pendingRole}
                    onChange={setPendingRole}
                  />
                  <p className="mt-1 pl-3 text-xs leading-[18px] text-wz-outline-label">
                    Changing the role resets this user&apos;s custom permission overrides.
                  </p>
                  <div className="mt-4 flex justify-end">
                    <WzButton
                      variant="primary"
                      size="regular"
                      disabled={pendingRole === user.roleId}
                      loading={assignRole.isPending}
                      onClick={() => setConfirmRole(true)}
                    >
                      Update role
                    </WzButton>
                  </div>
                </div>
              ) : (
                <div>
                  <WzOutlinedTextField label="Role" value={role} readOnly disabled />
                  <p className="mt-1 pl-3 text-xs leading-[18px] text-wz-outline-label">
                    You don&apos;t have permission to change this user&apos;s role.
                  </p>
                </div>
              )}
              <Link
                href={`/admin/users/${user.id}/permissions`}
                onClick={onClose}
                className="text-sm leading-[21px] text-wz-link hover:underline"
              >
                Customize roles and permissions here
              </Link>
            </div>
          ) : null}

          {tab === "permissions" ? (
            <UserPermissionsSummary user={user} roleLabel={role} canEdit={canEdit} onClose={onClose} />
          ) : null}

          {tab === "activity" ? (
            <dl className="divide-y divide-wz-frame text-sm leading-4 tracking-[0.4px] text-wz-strong">
              <div className="flex justify-between py-4">
                <dt className="text-wz-outline-label">Created</dt>
                <dd>{formatTeamCreated(user.createdAt) || "—"}</dd>
              </div>
              <div className="flex justify-between py-4">
                <dt className="text-wz-outline-label">Last updated</dt>
                <dd>{formatTeamCreated(user.updatedAt) || "—"}</dd>
              </div>
              <div className="flex justify-between py-4">
                <dt className="text-wz-outline-label">User ID</dt>
                <dd className="font-mono text-xs">{user.id}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </SheetContent>

      {/* Confirm: change role */}
      <AlertDialog open={confirmRole} onOpenChange={setConfirmRole}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change this user&apos;s role?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll get the permissions of <strong>{roleName(pendingRole, roles)}</strong>. Any custom permission
              overrides on this user will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => assignRole.mutate({ id: user.id, roleId: pendingRole })}>
              Update role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: deactivate */}
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {user.firstName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access immediately. Their history is kept and you can reactivate them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deactivate.mutate(user.id);
                onClose();
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
