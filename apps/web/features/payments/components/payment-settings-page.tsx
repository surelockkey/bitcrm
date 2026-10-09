"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, CreditCard, TriangleAlert } from "lucide-react";
import { MAX_SURCHARGE_PERCENT } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzActionBar } from "@/components/workiz/layout";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzPayRow, WzPaySection } from "@/components/workiz/settings-form";
import { WzSettingsHeader } from "@/components/workiz/settings-page";
import { WzMiniToggle } from "@/components/workiz/switch-tabs";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { usePaymentSettings, useUpdatePaymentSettings } from "../hooks";
import { SURCHARGE_WARNING } from "../lib";
import {
  paymentSettingsSchema,
  settingsToForm,
  toSettingsBody,
  type PaymentSettingsFormValues,
} from "../schemas";

type Errors = Partial<Record<keyof PaymentSettingsFormValues, string>>;

/** The 12px #e35a36 refusal under a row (Workiz's field error). */
function RowError({ children }: { children?: string }) {
  return children ? <p className="-mt-4 text-xs leading-[18px] text-wz-error">{children}</p> : null;
}

/** A line of Workiz's notice colours: green when all is well, orange to warn. */
function Notice({ tone, children }: { tone: "ok" | "warn"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-[8px] border p-4 text-sm leading-[21px] tracking-[0.4px] text-foreground",
        tone === "ok" ? "border-wz-tag-success" : "border-wz-toast-warning",
      )}
    >
      {tone === "ok" ? (
        <CheckCircle2 className="mt-0.5 size-4 flex-none text-wz-tag-success" aria-hidden />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 flex-none text-wz-toast-warning" aria-hidden />
      )}
      <span>{children}</span>
    </p>
  );
}

/**
 * Settings → Payments, drawn as Workiz Pay → My account
 * (pg_settings_general_wz_workizpay_myaccount): under the settings band,
 * sections over 1px rules — a 20px title, the grey line under it — of rows
 * with the words at the left and the 32×16 toggle or the box at the right;
 * Save in the white bar at the bottom (the Account page's). What the client
 * is offered when they open an invoice in their portal, and what it costs
 * them. Surcharging ships off — see the warning by the field.
 */
export function PaymentSettingsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canRead = can("settings");
  const canEdit = can("settings", "edit");
  const { data: settings, isLoading } = usePaymentSettings(canRead);
  const save = useUpdatePaymentSettings();

  // The form is the server document with the user's edits laid over it — a
  // background refetch never clobbers a draft.
  const [draft, setDraft] = useState<Partial<PaymentSettingsFormValues>>({});
  const [errors, setErrors] = useState<Errors>({});
  const form: PaymentSettingsFormValues = { ...settingsToForm(settings), ...draft };
  const dirty = Object.keys(draft).length > 0;

  const set = <K extends keyof PaymentSettingsFormValues>(
    key: K,
    value: PaymentSettingsFormValues[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = () => {
    const parsed = paymentSettingsSchema.safeParse(form);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof PaymentSettingsFormValues;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(toSettingsBody(parsed.data), { onSuccess: () => setDraft({}) });
  };

  const header = (
    <WzSettingsHeader
      icon={<CreditCard />}
      title="Payments"
      description="How clients pay an invoice from their portal — and what staff can take by hand. Cash, cheques and card terminals are always available on the job's Invoice tab."
    />
  );

  // A refusal only once the answer is in — before it, `can` says no to all,
  // and the settings are not asked for yet: one skeleton covers both.
  if (denied("settings")) return <NoAccess what="settings" />;
  if (permsLoading || isLoading) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <div className="px-10 pt-10">
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  const online = form.onlinePaymentsEnabled;
  const stripeReady = settings?.stripeConfigured === true;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {header}
      <div className="px-10">
        <WzPaySection
          title="Online payments"
          subtitle="The master switch. With it off, invoices go out with no Pay button and the ledger still records what you take yourself."
        >
          <WzPayRow label="Accept payments online">
            <WzMiniToggle
              label="Accept payments online"
              checked={online}
              onCheckedChange={(v) => set("onlinePaymentsEnabled", v)}
              disabled={!canEdit}
            />
          </WzPayRow>
          <RowError>{errors.onlinePaymentsEnabled}</RowError>
          {stripeReady ? (
            <Notice tone="ok">Stripe keys are set up on the server, so online payments can run.</Notice>
          ) : (
            <Notice tone="warn">
              No Stripe keys on the server yet — online payments stay unavailable until an administrator adds them.
            </Notice>
          )}
        </WzPaySection>

        <WzPaySection
          title="Payment settings"
          subtitle="What the client can pay with — offered on every invoice unless the send dialog narrows it for that one document."
        >
          <WzPayRow label="Card & wallets">
            <WzMiniToggle
              label="Card payments"
              checked={form.cardEnabled}
              onCheckedChange={(v) => set("cardEnabled", v)}
              disabled={!canEdit}
            />
          </WzPayRow>
          <RowError>{errors.cardEnabled}</RowError>
          <WzPayRow
            label="Accept bank transfers (ACH)"
            hint="Bank payments cost far less than cards on a big invoice, but they take 2–4 business days to clear and can still be returned after that."
          >
            <WzMiniToggle
              label="Bank payments"
              checked={form.bankEnabled}
              onCheckedChange={(v) => set("bankEnabled", v)}
              disabled={!canEdit}
            />
          </WzPayRow>
          <WzPayRow
            label="Bank minimum"
            htmlFor="pay-bank-minimum"
            hint="Below this, the client is only offered a card."
            className={cn(!form.bankEnabled && "opacity-60")}
          >
            <WzOutlinedTextField
              id="pay-bank-minimum"
              type="text"
              inputMode="decimal"
              className="w-[200px]"
              inputClassName="tabular-nums"
              value={form.bankMinimum}
              error={errors.bankMinimum}
              onChange={(e) => set("bankMinimum", e.target.value)}
              disabled={!canEdit || !form.bankEnabled}
            />
          </WzPayRow>
          <WzPayRow label="Let the client pay part of the balance">
            <WzMiniToggle
              label="Allow part payments"
              checked={form.allowPartial}
              onCheckedChange={(v) => set("allowPartial", v)}
              disabled={!canEdit}
            />
          </WzPayRow>
        </WzPaySection>

        <WzPaySection title="Card surcharge" subtitle="Passing the card fee on to the client.">
          <WzPayRow
            label="Surcharge percent"
            htmlFor="pay-surcharge"
            hint={`Between 0 and ${MAX_SURCHARGE_PERCENT}. Leave it at 0 to charge nothing extra.`}
          >
            <WzOutlinedTextField
              id="pay-surcharge"
              type="text"
              inputMode="decimal"
              className="w-[200px]"
              inputClassName="tabular-nums"
              value={form.surchargePercent}
              error={errors.surchargePercent}
              onChange={(e) => set("surchargePercent", e.target.value)}
              disabled={!canEdit}
            />
          </WzPayRow>
          <WzPayRow
            label="Fee label"
            htmlFor="pay-surcharge-label"
            hint="What the client sees on the payment page and the receipt."
          >
            <WzOutlinedTextField
              id="pay-surcharge-label"
              className="w-[320px]"
              maxLength={60}
              value={form.surchargeLabel}
              error={errors.surchargeLabel}
              onChange={(e) => set("surchargeLabel", e.target.value)}
              disabled={!canEdit}
            />
          </WzPayRow>
          <Notice tone="warn">{SURCHARGE_WARNING}</Notice>
        </WzPaySection>

        <WzPaySection title="Tips" subtitle="Offering the client a tip at the end of the payment.">
          <p className="text-sm leading-[21px] tracking-[0.4px] text-wz-outline-label">
            <span className="mr-2 inline-flex h-5 items-center rounded-[10px] bg-border px-2 text-[11px] leading-4 font-semibold text-foreground">
              Coming soon
            </span>
            The tip step isn&apos;t built yet — these settings are here so nothing is lost when it is.
          </p>
          <WzPayRow label="Ask for a tip at checkout" className="opacity-60">
            <WzMiniToggle label="Ask for a tip" checked={false} onCheckedChange={() => {}} disabled />
          </WzPayRow>
          <WzPayRow
            label="Tip presets"
            htmlFor="pay-tip-presets"
            hint="Percentages offered as buttons, e.g. 10, 15, 20."
            className="opacity-60"
          >
            <WzOutlinedTextField
              id="pay-tip-presets"
              className="w-[200px]"
              value={form.tipPresets}
              error={errors.tipPresets}
              onChange={(e) => set("tipPresets", e.target.value)}
              disabled
            />
          </WzPayRow>
        </WzPaySection>

        {!canEdit ? (
          <p className="pb-10 text-xs leading-[18px] text-wz-outline-label">
            Editing needs the &quot;settings · edit&quot; permission.
          </p>
        ) : null}
      </div>

      {canEdit ? (
        <WzActionBar className="sticky bottom-0 mt-auto">
          <WzButton
            variant="secondary"
            size="big"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft({});
              setErrors({});
            }}
          >
            Reset
          </WzButton>
          <WzButton size="big" className="min-w-[81px]" loading={save.isPending} onClick={submit}>
            Save
          </WzButton>
        </WzActionBar>
      ) : null}
    </div>
  );
}
