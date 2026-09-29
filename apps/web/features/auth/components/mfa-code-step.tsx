"use client";

import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useAuthStore } from "@/stores/auth-store";
import { useResendMfa, useVerifyMfa } from "@/features/auth/hooks";

/**
 * The second step of a sign-in: the password was right, and a code has been
 * texted to the account's phone. The tokens wait on the server until the
 * code comes back.
 */
export function MfaCodeStep({ destination }: { destination: string }) {
  const [code, setCode] = useState("");
  const verify = useVerifyMfa();
  const resend = useResendMfa();
  const back = () => useAuthStore.getState().setMfaChallenge(null);

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) verify.mutate(code.trim());
      }}
    >
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">Check your phone</h2>
        <p className="text-sm text-muted-foreground">
          We texted a sign-in code to <span className="font-medium text-foreground">{destination}</span>.
        </p>
      </div>

      {verify.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(verify.error)}</AlertDescription>
        </Alert>
      ) : resend.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(resend.error)}</AlertDescription>
        </Alert>
      ) : resend.isSuccess ? (
        <Alert>
          <AlertDescription>Code sent again to {resend.data.destination}.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="mfa-code">Code</Label>
        <Input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={10}
          placeholder="123456"
          className="h-11 tracking-widest"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </div>

      <Button
        type="submit"
        variant="brand"
        className="h-11 w-full text-[0.95rem] font-semibold"
        disabled={verify.isPending || !code}
      >
        {verify.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        Verify
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={back} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <button
          type="button"
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          className="font-medium text-brand hover:underline disabled:opacity-50"
        >
          Send again
        </button>
      </div>
    </form>
  );
}
