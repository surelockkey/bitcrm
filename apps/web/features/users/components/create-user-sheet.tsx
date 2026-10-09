"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PhoneInput } from "@/components/ui/phone-input";
import { WzButton } from "@/components/workiz/button";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { createUserSchema, type CreateUserValues } from "../schemas";
import { useCreateUser } from "../hooks";
import { useHierarchy } from "../use-can-manage";

/**
 * "+ Add New" on the Users and Technicians lists: the invite, in the drawer
 * with Workiz's outlined boxes (the user page's, pg_technicians_wz_10) —
 * name, email, role, department, an optional phone — and Cancel / Send
 * invite at the foot.
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
      firstName: "",
      lastName: "",
      email: "",
      roleId: "",
      department: "",
      phone: "",
    },
  });
  const errors = form.formState.errors;

  const onSubmit = (values: CreateUserValues) =>
    mutation.mutate(values, {
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
          <SheetTitle>Invite a user</SheetTitle>
          <SheetDescription className="text-sm leading-[21px] text-wz-strong">
            They&apos;ll get an email with a temporary password and set their own on first sign-in.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden" noValidate>
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pt-4 pb-6">
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
              Send invite
            </WzButton>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
