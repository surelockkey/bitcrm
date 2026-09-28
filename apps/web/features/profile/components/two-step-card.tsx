"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import type { User } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import { useConfirmMyMfa, useDisableMyMfa, useStartMyMfa } from "@/features/users/hooks";

/**
 * Two-step sign-in on your own profile: after the password, a code texted to
 * the phone on this profile. Switching it on is proved — a code goes to that
 * phone and has to come back — and switching it off is one click.
 */
export function TwoStepCard({ me }: { me: User }) {
  const start = useStartMyMfa();
  const confirm = useConfirmMyMfa();
  const disable = useDisableMyMfa();
  const [code, setCode] = useState("");

  // What the server last said, ahead of `me` catching up.
  const [enabled, setEnabled] = useState(!!me.smsMfaEnabled);
  const [seen, setSeen] = useState(me.smsMfaEnabled);
  if (seen !== me.smsMfaEnabled) {
    setSeen(me.smsMfaEnabled);
    setEnabled(!!me.smsMfaEnabled);
  }

  const awaitingCode = !enabled && start.isSuccess;

  const turnOn = () => {
    confirm.reset();
    setCode("");
    start.mutate();
  };
  const submit = () =>
    confirm.mutate(code, {
      onSuccess: () => {
        setEnabled(true);
        start.reset();
      },
    });
  const turnOff = () => disable.mutate(undefined, { onSuccess: () => setEnabled(false) });

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className={enabled ? "mt-0.5 size-4 text-green-600" : "mt-0.5 size-4 text-muted-foreground"} />
          <div>
            <div className="text-sm font-medium">Two-step sign-in</div>
            <p className="text-xs text-muted-foreground">
              {enabled
                ? `Two-step sign-in is on — codes are texted to ${me.phone ? formatPhone(me.phone) : "your phone"}.`
                : me.phone
                  ? "After your password, we text a code to your phone."
                  : "Add your phone above to use two-step sign-in."}
            </p>
          </div>
        </div>
        {enabled ? (
          <Button variant="outline" size="sm" onClick={turnOff} disabled={disable.isPending} className="gap-1.5">
            {disable.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Turn off
          </Button>
        ) : !awaitingCode ? (
          <Button variant="outline" size="sm" onClick={turnOn} disabled={!me.phone || start.isPending} className="gap-1.5">
            {start.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Turn on
          </Button>
        ) : null}
      </div>

      {start.isError ? (
        <p className="mt-3 text-xs text-destructive">{getApiErrorMessage(start.error)}</p>
      ) : null}

      {awaitingCode ? (
        <form
          className="mt-4 space-y-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code) submit();
          }}
        >
          <Label htmlFor="two-step-code">Code sent to {start.data.destination}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="two-step-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              placeholder="123456"
              className="h-9 w-36 tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <Button type="submit" variant="brand" size="sm" disabled={!code || confirm.isPending} className="gap-1.5">
              {confirm.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Confirm
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={turnOn} disabled={start.isPending}>
              Send again
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => start.reset()}>
              Cancel
            </Button>
          </div>
          {confirm.isError ? (
            <p className="text-xs text-destructive">{getApiErrorMessage(confirm.error)}</p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
