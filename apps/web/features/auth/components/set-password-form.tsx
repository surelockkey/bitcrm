"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthCard } from "@/components/auth/auth-card";
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
import { setPasswordSchema, type SetPasswordValues } from "@/features/auth/schemas";
import { useSetPassword } from "@/features/auth/hooks";
import { useAuthStore } from "@/stores/auth-store";

export function SetPasswordForm() {
  const router = useRouter();
  const hasChallenge = useAuthStore(
    (s) => Boolean(s.pendingEmail) && Boolean(s.challengeSession),
  );

  // Reachable only via a first-login challenge; otherwise send to sign-in.
  useEffect(() => {
    if (!hasChallenge) router.replace("/login");
  }, [hasChallenge, router]);

  const form = useForm<SetPasswordValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });
  const mutation = useSetPassword();
  const newPassword = useWatch({ control: form.control, name: "newPassword" }) ?? "";

  return (
    <AuthCard>
      <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) =>
              mutation.mutate({ newPassword: values.newPassword }),
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
              Set password &amp; sign in
            </Button>
          </form>
      </Form>
    </AuthCard>
  );
}
