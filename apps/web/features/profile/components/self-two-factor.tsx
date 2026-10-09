"use client";

import { useId, useState } from "react";
import type { User } from "@bitcrm/types";
import { PhoneInput } from "@/components/ui/phone-input";
import { WzButton } from "@/components/workiz/button";
import { WzInfoTip } from "@/components/workiz/form-section-title";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzMiniToggle } from "@/components/workiz/switch-tabs";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone, isValidPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useConfirmMyMfa, useDisableMyMfa, useStartMyMfa, useUpdateMyPhone } from "@/features/users/hooks";

/** The label in a notched box's edge (FloatingLabel-module): 11px ink on white, 8px in, 8px up. */
const NOTCH =
  "pointer-events-none absolute -top-2 left-2 z-[1] bg-white px-1 text-[11px] leading-[normal] tracking-[0.4px] text-foreground";
/** Our phone control drawn as Workiz's outlined box: 40px, 1px #9ea6aa, 4px corners. */
const PHONE_BOX =
  "text-[13px] [&>div:first-child]:h-10 [&>div:first-child]:rounded-[4px] [&>div:first-child]:border-wz-outline [&>div:first-child]:shadow-none [&>div:first-child]:focus-within:border-wz-link [&>div:first-child]:focus-within:ring-0";
/** Workiz's line under a field (11px #768287) and its refusal (12px #e35a36). */
const HELPER = "text-[11px] leading-4 tracking-[0.4px] text-wz-outline-label";
const ERROR = "text-xs leading-4 text-wz-error";

/**
 * Two-step sign-in on your own profile, drawn as the user page's
 * "Two-factor authentication ⓘ" row (pg_technicians_wz_10_user_profile):
 * 14px #404040 words, the ⓘ, Workiz's 32×16 switch at the column's edge.
 * The ⓘ says what the switch does — and, on, where the codes go.
 *
 * Unlike the admin's switch on someone else's card, turning it on here is
 * proved: a code goes to the phone and has to come back. With no phone on
 * the profile the switch still works — it asks for the phone right under
 * the row, then texts it. The steps hang under the row in Workiz's 40px
 * outlined boxes and pills; the row's switch reads "on" while they are open.
 *
 * `required` — Settings → Security Center's "Require Two-factor
 * authentication": the account decides, so the row reads "Required by your
 * account", the switch is on and cannot go off (the server refuses too).
 */
export function SelfTwoFactor({ me, required = false, className }: { me: User; required?: boolean; className?: string }) {
  const start = useStartMyMfa();
  const confirm = useConfirmMyMfa();
  const disable = useDisableMyMfa();
  const savePhone = useUpdateMyPhone();
  const tipId = useId();
  const codeId = useId();

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

  const cancel = () => {
    setStep("idle");
    start.reset();
    confirm.reset();
  };

  const onToggle = (next: boolean) => {
    if (step !== "idle" && !next) return cancel();
    if (!next) {
      disable.mutate(undefined, { onSuccess: () => setEnabled(false) });
      return;
    }
    if (me.phone) sendCode();
    else setStep("phone");
  };

  const busy = start.isPending || disable.isPending || confirm.isPending || savePhone.isPending;
  const codesTo = me.phone ? formatPhone(me.phone) : "your phone";
  const tip = required
    ? `Required by your account: after your password we text a code to ${codesTo}.`
    : enabled
      ? `After your password we text a code to ${codesTo}.`
      : "Off: you sign in with your password only. Turn it on to also get a code by text.";

  return (
    <div className={className} data-testid="self-two-factor">
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="flex items-center text-sm leading-4 tracking-[0.4px] text-wz-strong">
            Two-factor authentication
            <WzInfoTip id={tipId} label="Two-factor authentication" text={tip} />
          </span>
          {required ? (
            <span className="mt-1 text-xs leading-[18px] tracking-[0.4px] text-wz-outline-label">Required by your account</span>
          ) : null}
        </span>
        <WzMiniToggle
          label="Two-factor authentication"
          checked={required || enabled || step !== "idle"}
          disabled={busy || required}
          onCheckedChange={onToggle}
          aria-describedby={tipId}
        />
      </div>

      {start.isError ? <p className={cn(ERROR, "mt-2")}>{getApiErrorMessage(start.error)}</p> : null}
      {disable.isError ? <p className={cn(ERROR, "mt-2")}>{getApiErrorMessage(disable.error)}</p> : null}

      {step === "phone" ? (
        <form
          data-testid="two-step-phone"
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isValidPhone(phone)) return;
            savePhone.mutate(phone, { onSuccess: sendCode });
          }}
        >
          <div className="relative">
            <span aria-hidden className={NOTCH}>
              Your phone for sign-in codes
            </span>
            <PhoneInput className={PHONE_BOX} value={phone} onChange={setPhone} autoFocus aria-label="Your phone for sign-in codes" />
          </div>
          <p className={HELPER}>It is saved to your profile — it is also the number your calls are recognised by.</p>
          {savePhone.isError ? <p className={ERROR}>{getApiErrorMessage(savePhone.error)}</p> : null}
          <div className="flex items-center gap-2 pt-1">
            <WzButton type="submit" size="regular" disabled={!isValidPhone(phone) || busy} loading={savePhone.isPending}>
              Send code
            </WzButton>
            <WzButton variant="tertiary" size="regular" onClick={cancel}>
              Cancel
            </WzButton>
          </div>
        </form>
      ) : null}

      {step === "code" ? (
        <form
          className="mt-4 space-y-2"
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
          <WzOutlinedTextField
            id={codeId}
            label={`Code sent to ${destination}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={10}
            placeholder="123456"
            inputClassName="tracking-[0.3em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            error={confirm.isError ? getApiErrorMessage(confirm.error) : undefined}
          />
          <div className="flex items-center gap-2 pt-1">
            <WzButton type="submit" size="regular" disabled={!code || busy} loading={confirm.isPending}>
              Confirm
            </WzButton>
            <WzButton variant="tertiary" size="regular" onClick={sendCode} disabled={busy}>
              Send again
            </WzButton>
            <WzButton variant="tertiary" size="regular" onClick={cancel}>
              Cancel
            </WzButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
