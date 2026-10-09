"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PhoneInput } from "@/components/ui/phone-input";
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

  // Workiz's "Add team member": a User signs in and has a role; a
  // Subcontractor does neither (the API makes them a technician).
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
      <SheetContent className="flex w-full flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b">
          {/* Workiz's pane title. A subcontractor is not invited: there is no sign-in to invite them to. */}
          <SheetTitle>Add team member</SheetTitle>
          <SheetDescription>
            {subcontractor
              ? "No sign-in: job details reach them by text or email."
              : "They'll get an email with a temporary password and set their own on first sign-in."}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col overflow-hidden"
            noValidate
          >
            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <div>
                <WzRadioButtons<UserType>
                  aria-label="User type"
                  aria-describedby="create-user-type-help"
                  options={USER_TYPE_OPTIONS}
                  value={userType}
                  onChange={(v) => form.setValue("userType", v, { shouldValidate: false })}
                />
                <small id="create-user-type-help" className="mt-2.5 block text-[11px] leading-[13px] tracking-[0.4px] text-wz-caption">
                  {subcontractor ? "Can not login, can take jobs and get messages" : "Can login and work on your account"}
                </small>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl>
                        <Input className="h-10" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
                      <FormControl>
                        <Input className="h-10" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        className="h-10"
                        placeholder="name@surelockkey.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {subcontractor ? null : (
              <FormField
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-10 w-full">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {roleOptions.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              )}

              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <Input
                        className="h-10"
                        placeholder="e.g. Dispatch, Field, Management"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone (optional)</FormLabel>
                    <FormControl>
                      <PhoneInput
                        className="h-10"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormDescription>
                      Their own number. Calls to or from it are shown as
                      reaching them directly.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t p-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="brand"
                disabled={mutation.isPending}
                className="gap-1.5"
              >
                {mutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {subcontractor ? "Add user" : "Send invite"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
