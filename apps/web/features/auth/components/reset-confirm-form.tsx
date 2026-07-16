"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthCard } from "@/components/auth/auth-card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { getApiErrorMessage } from "@/lib/api/errors";
import { resetConfirmSchema, type ResetConfirmValues } from "@/features/auth/schemas";
import { useConfirmReset } from "@/features/auth/hooks";

export function ResetConfirmForm({
  email,
  onDone,
}: {
  email: string;
  onDone: () => void;
}) {
  const form = useForm<ResetConfirmValues>({
    resolver: zodResolver(resetConfirmSchema),
    defaultValues: { email, code: "", newPassword: "", confirmPassword: "" },
  });
  const mutation = useConfirmReset();
  const newPassword = useWatch({ control: form.control, name: "newPassword" }) ?? "";

  return (
    <AuthCard>
      <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) =>
              mutation.mutate(
                {
                  email: values.email,
                  code: values.code,
                  newPassword: values.newPassword,
                },
                { onSuccess: onDone },
              ),
            )}
            className="grid gap-5"
            noValidate
          >
            {mutation.isError ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {getApiErrorMessage(mutation.error)}
                </AlertDescription>
              </Alert>
            ) : null}

            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reset code</FormLabel>
                  <FormControl>
                    <InputOTP
                      maxLength={6}
                      value={field.value}
                      onChange={field.onChange}
                      containerClassName="w-full"
                    >
                      <InputOTPGroup className="w-full gap-2.5">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <InputOTPSlot
                            key={i}
                            index={i}
                            className="h-14 flex-1 text-lg"
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Choose a new password"
                      className="h-11"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Re-enter new password"
                      className="h-11"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <PasswordRequirements password={newPassword} />

            <Button
              type="submit"
              variant="brand"
              className="h-11 w-full text-[0.95rem] font-semibold"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Reset password
            </Button>
          </form>
      </Form>
    </AuthCard>
  );
}
