"use client";

import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PhoneInput } from "@/components/ui/phone-input";
import { WzButton } from "@/components/workiz/button";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzRadioButtons } from "@/components/workiz/radio-buttons";
import type { UserType } from "@bitcrm/types";
import { createUserSchema, toCreateUserRequest, type CreateUserValues } from "../schemas";
import { useCreateUser } from "../hooks";
import { useHierarchy } from "../use-can-manage";

/** Workiz's words: "User" (signs in, a paid seat) | "Subcontractor" (free, no sign-in). */
const USER_TYPE_OPTIONS = [
  { value: "regular", label: "User" },
  { value: "subcontractor", label: "Subcontractor" },
] as const;

/**
 * "+ Add New" on the Users and Technicians lists: Workiz's "Add team member"
 * pane (subcontractor_wz_04b_add_new_subcontractor) in the drawer, with the
 * user page's outlined boxes (pg_technicians_wz_10). A User | Subcontractor
 * switch on top: a User "Can login and work on your account", gets a role
 * and is invited; a Subcontractor "Can not login, can take jobs and get
 * messages" — no role, no invitation, "Add user" (the API makes them a
 * technician). Then name, email, department, an optional phone, and Cancel /
 * Send invite (or Add user) at the foot.
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

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      userType: "regular",
      firstName: "",
      lastName: "",
      email: "",
      roleId: "",
      department: "",
      phone: "",
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        onInteractOutside={(e) => {
          // The role list sits in a portal; picking from it is not a click outside.
          if ((e.target as Element | null)?.closest("[data-wz-combobox-root],[role=listbox]")) e.preventDefault();
        }}
      >
        <SheetHeader className="px-6 pt-6 pb-2">
          {/* Workiz's pane title. A subcontractor is not invited: there is no sign-in to invite them to. */}
          <SheetTitle>Add team member</SheetTitle>
          <SheetDescription className="text-sm leading-[21px] text-wz-strong">
            {subcontractor
              ? "No sign-in: job details reach them by text or email."
              : "They'll get an email with a temporary password and set their own on first sign-in."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden" noValidate>
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pt-4 pb-6">
            <div>
              <WzRadioButtons<UserType>
                aria-label="User type"
                aria-describedby="create-user-type-help"
                options={USER_TYPE_OPTIONS}
                value={userType}
                onChange={(v) => form.setValue("userType", v, { shouldValidate: false })}
              />
              <small
                id="create-user-type-help"
                className="mt-2.5 block text-[11px] leading-[13px] tracking-[0.4px] text-wz-caption"
              >
                {subcontractor ? "Can not login, can take jobs and get messages" : "Can login and work on your account"}
              </small>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <WzOutlinedTextField label="First name" error={errors.firstName?.message} {...form.register("firstName")} />
              <WzOutlinedTextField label="Last name" error={errors.lastName?.message} {...form.register("lastName")} />
            </div>
            <WzOutlinedTextField
              label="Email"
              type="email"
              placeholder="name@surelockkey.com"
              error={errors.email?.message}
              {...form.register("email")}
            />
            {subcontractor ? null : (
              <Controller
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <WzOutlinedSelect
                    label="Role"
                    placeholder="Select a role"
                    options={roleOptions.map((r) => ({ value: r.id, label: r.name }))}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={errors.roleId?.message}
                  />
                )}
              />
            )}
            <WzOutlinedTextField
              label="Department"
              placeholder="e.g. Dispatch, Field, Management"
              error={errors.department?.message}
              {...form.register("department")}
            />
            <div>
              <label htmlFor="invite-phone" className="mb-1.5 block text-[13px] leading-[19px] font-medium text-foreground">
                Phone (optional)
              </label>
              <Controller
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <PhoneInput id="invite-phone" className="h-10" value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur} />
                )}
              />
              <p className="mt-1 pl-3 text-xs leading-[18px] text-wz-outline-label">
                Their own number. Calls to or from it are shown as reaching them directly.
              </p>
              {errors.phone?.message ? <p className="mt-1 pl-3 text-xs text-wz-error">{errors.phone.message}</p> : null}
            </div>
          </div>

          <div className="flex items-center justify-end gap-4 border-t border-[#eeeeee] px-6 py-4">
            <WzButton variant="secondary" size="big" onClick={() => onOpenChange(false)}>
              Cancel
            </WzButton>
            <WzButton type="submit" variant="primary" size="big" loading={mutation.isPending}>
              {subcontractor ? "Add user" : "Send invite"}
            </WzButton>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
