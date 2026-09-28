"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import type { User } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Switch } from "@/components/ui/switch";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone, isValidPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useConfirmMyMfa, useDisableMyMfa, useStartMyMfa, useUpdateMyPhone } from "@/features/users/hooks";
import { TwoStepStatus } from "@/features/users/components/two-step-status";

/**
 * Two-step sign-in on your own profile: after the password, a code texted to
 * your phone. One switch and an On / Off you can read at a glance.
 *
 * Switching it on is proved — a code goes to the phone and has to come back.
 * With no phone on the profile the switch still works: it asks for the
 * phone right here, then texts it, instead of sitting greyed out.
 */
export function TwoStepCard({ me }: { me: User }) {
  const start = useStartMyMfa();
  const confirm = useConfirmMyMfa();
  const disable = useDisableMyMfa();
  const savePhone = useUpdateMyPhone();

  // What the server last said, ahead of `me` catching up.
  const [enabled, setEnabled] = useState(!!me.smsMfaEnabled);
  const [seen, setSeen] = useState(me.smsMfaEnabled);
  if (seen !== me.smsMfaEnabled) {
    setSeen(me.smsMfaEnabled);
    setEnabled(!!me.smsMfaEnabled);
  }

  // Turning on: first a phone (when there is none), then the code.
  const [step, setStep] = useState<"idle" | "phone" | "code">("idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [destination, setDestination] = useState("");

  const sendCode = () =>
    start.mutate(undefined, {
      onSuccess: (res) => {
        setDestination(res.destination);
        setCode("");
        confirm.reset();
        setStep("code");
      },
    });

  const onToggle = (next: boolean) => {
    if (!next) {
      disable.mutate(undefined, { onSuccess: () => setEnabled(false) });
      return;
    }
    if (me.phone) sendCode();
    else setStep("phone");
  };

  const cancel = () => {
    setStep("idle");
    start.reset();
    confirm.reset();
  };

  const busy = start.isPending || disable.isPending || confirm.isPending || savePhone.isPending;
  const pendingOn = step !== "idle";

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className={cn("mt-0.5 size-5", enabled ? "text-green-600" : "text-muted-foreground")} />
          <div>
            <div className="flex items-center gap-2">
              <label htmlFor="two-step-switch" className="text-sm font-medium">
                Two-step sign-in
              </label>
              <TwoStepStatus enabled={enabled} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {enabled
                ? `After your password we text a code to ${me.phone ? formatPhone(me.phone) : "your phone"}.`
                : "Off: you sign in with your password only. Turn on to also get a code by text."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          <Switch
            id="two-step-switch"
            aria-label="Two-step sign-in"
            checked={enabled || pendingOn}
            disabled={busy}
            onCheckedChange={(next) => (pendingOn && !next ? cancel() : onToggle(next))}
          />
        </div>
      </div>

      {start.isError ? <p className="mt-3 text-xs text-destructive">{getApiErrorMessage(start.error)}</p> : null}
      {disable.isError ? <p className="mt-3 text-xs text-destructive">{getApiErrorMessage(disable.error)}</p> : null}

      {step === "phone" ? (
        <form
          data-testid="two-step-phone"
          className="mt-4 space-y-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isValidPhone(phone)) return;
            savePhone.mutate(phone, { onSuccess: sendCode });
          }}
        >
          <Label>Your phone for sign-in codes</Label>
          <div className="flex flex-wrap items-center gap-2">
            <PhoneInput className="h-9 w-64" value={phone} onChange={setPhone} autoFocus />
            <Button type="submit" variant="brand" size="sm" disabled={!isValidPhone(phone) || busy}>
              Send code
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            It is saved to your profile — it is also the number your calls are recognised by.
          </p>
          {savePhone.isError ? <p className="text-xs text-destructive">{getApiErrorMessage(savePhone.error)}</p> : null}
        </form>
      ) : null}

      {step === "code" ? (
        <form
          className="mt-4 space-y-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!code) return;
            confirm.mutate(code, {
              onSuccess: () => {
                setEnabled(true);
                setStep("idle");
              },
            });
          }}
        >
          <Label htmlFor="two-step-code">Code sent to {destination}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="two-step-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={10}
              placeholder="123456"
              className="h-9 w-36 tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <Button type="submit" variant="brand" size="sm" disabled={!code || busy}>
              Confirm
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={sendCode} disabled={busy}>
              Send again
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
          </div>
          {confirm.isError ? <p className="text-xs text-destructive">{getApiErrorMessage(confirm.error)}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
