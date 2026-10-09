"use client";

import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { getApiErrorMessage } from "@/lib/api/errors";
import { isValidPhone } from "@/lib/phone";
import { useAuthStore } from "@/stores/auth-store";
import { useSetupMfaPhone } from "@/features/auth/hooks";

/**
 * Workiz's "Set up two-factor authentication" step: the account requires a
 * second step at sign-in (Settings → Security Center) and this person has no
 * phone on their profile yet. The password was right; the tokens wait on
 * the server until the phone given here has proved it receives texts — its
 * code is the next screen. There is no "Skip for now": the requirement is
 * the account's.
 */
export function MfaSetupStep() {
  const [phone, setPhone] = useState("");
  const setup = useSetupMfaPhone();
  const back = () => useAuthStore.getState().setMfaChallenge(null);

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (isValidPhone(phone)) setup.mutate(phone);
      }}
    >
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">Set up two-factor authentication</h2>
        <p className="text-sm text-muted-foreground">
          Your account requires a code at every sign-in. Enter the mobile number we should text it to — it is
          saved to your profile once the first code comes back.
        </p>
      </div>

      {setup.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(setup.error)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="mfa-setup-phone">Phone</Label>
        <PhoneInput id="mfa-setup-phone" className="h-11" value={phone} onChange={setPhone} autoFocus />
      </div>

      <Button
        type="submit"
        variant="brand"
        className="h-11 w-full text-[0.95rem] font-semibold"
        disabled={setup.isPending || !isValidPhone(phone)}
      >
        {setup.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        Send code
      </Button>

      <div className="flex items-center text-sm">
        <button type="button" onClick={back} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back
        </button>
      </div>
    </form>
  );
}
