"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { MAX_SURCHARGE_PERCENT } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
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

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="space-y-3 rounded-lg border p-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Settings → Payments. What the client is offered when they open an invoice in
 * their portal, and what it costs them. Surcharging ships off — see the
 * warning by the field.
 */
export function PaymentSettingsPage() {
  const { can } = usePermissions();
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

  if (!canRead) return <NoAccess what="settings" />;
  if (isLoading) return <Skeleton className="h-96 w-full max-w-3xl" />;

  const online = form.onlinePaymentsEnabled;
  const stripeReady = settings?.stripeConfigured === true;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Payments</h2>
        <p className="text-sm text-muted-foreground">
          How clients pay an invoice from their portal — and what staff can take by hand. Cash,
          cheques and card terminals are always available on the job&apos;s Invoice tab.
        </p>
      </div>

      <Section
        title="Online payments"
        hint="The master switch. With it off, invoices go out with no Pay button and the ledger still records what you take yourself."
      >
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={online}
            onCheckedChange={(v) => set("onlinePaymentsEnabled", v)}
            disabled={!canEdit}
            aria-label="Accept payments online"
          />
          Accept payments online
        </label>
        {errors.onlinePaymentsEnabled ? (
          <p className="text-xs text-destructive">{errors.onlinePaymentsEnabled}</p>
        ) : null}
        <p
          className={cn(
            "flex items-start gap-2 rounded-md border p-2.5 text-xs",
            stripeReady
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
          )}
        >
          {stripeReady ? (
            <CheckCircle2 className="mt-0.5 size-3.5 flex-none" aria-hidden />
          ) : (
            <TriangleAlert className="mt-0.5 size-3.5 flex-none" aria-hidden />
          )}
          {stripeReady
            ? "Stripe keys are set up on the server, so online payments can run."
            : "No Stripe keys on the server yet — online payments stay unavailable until an administrator adds them."}
        </p>
      </Section>

      <Section
        title="What the client can pay with"
        hint="Offered on every invoice unless the send dialog narrows it for that one document."
      >
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={form.cardEnabled}
            onCheckedChange={(v) => set("cardEnabled", v)}
            disabled={!canEdit}
            aria-label="Card payments"
          />
          Card &amp; wallets
        </label>
        {errors.cardEnabled ? <p className="text-xs text-destructive">{errors.cardEnabled}</p> : null}
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={form.bankEnabled}
            onCheckedChange={(v) => set("bankEnabled", v)}
            disabled={!canEdit}
            aria-label="Bank payments"
          />
          Bank transfer (ACH)
        </label>
        <p className="text-xs text-muted-foreground">
          Bank payments cost far less than cards on a big invoice, but they take 2–4 business days to
          clear and can still be returned after that.
        </p>
        <div className={cn("grid gap-3 sm:grid-cols-2", !form.bankEnabled && "opacity-60")}>
          <Field
            label="Bank minimum"
            htmlFor="pay-bank-minimum"
            hint="Below this, the client is only offered a card."
            error={errors.bankMinimum}
          >
            <Input
              id="pay-bank-minimum"
              type="text"
              inputMode="decimal"
              className="h-9 tabular-nums"
              value={form.bankMinimum}
              onChange={(e) => set("bankMinimum", e.target.value)}
              disabled={!canEdit || !form.bankEnabled}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={form.allowPartial}
            onCheckedChange={(v) => set("allowPartial", v)}
            disabled={!canEdit}
            aria-label="Allow part payments"
          />
          Let the client pay part of the balance
        </label>
      </Section>

      <Section title="Card surcharge" hint="Passing the card fee on to the client.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Surcharge percent"
            htmlFor="pay-surcharge"
            hint={`Between 0 and ${MAX_SURCHARGE_PERCENT}. Leave it at 0 to charge nothing extra.`}
            error={errors.surchargePercent}
          >
            <Input
              id="pay-surcharge"
              type="text"
              inputMode="decimal"
              className="h-9 tabular-nums"
              value={form.surchargePercent}
              onChange={(e) => set("surchargePercent", e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="Fee label"
            htmlFor="pay-surcharge-label"
            hint="What the client sees on the payment page and the receipt."
            error={errors.surchargeLabel}
          >
            <Input
              id="pay-surcharge-label"
              className="h-9"
              maxLength={60}
              value={form.surchargeLabel}
              onChange={(e) => set("surchargeLabel", e.target.value)}
              disabled={!canEdit}
            />
          </Field>
        </div>
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-3.5 flex-none" aria-hidden />
          <span>{SURCHARGE_WARNING}</span>
        </p>
      </Section>

      <Section title="Tips" hint="Offering the client a tip at the end of the payment.">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            Coming soon
          </Badge>
          <p className="text-xs text-muted-foreground">
            The tip step isn&apos;t built yet — these settings are here so nothing is lost when it is.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={false} disabled aria-label="Ask for a tip" />
          Ask for a tip at checkout
        </label>
        <Field
          label="Tip presets"
          htmlFor="pay-tip-presets"
          hint="Percentages offered as buttons, e.g. 10, 15, 20."
          error={errors.tipPresets}
        >
          <Input
            id="pay-tip-presets"
            className="h-9 sm:w-60"
            value={form.tipPresets}
            onChange={(e) => set("tipPresets", e.target.value)}
            disabled
          />
        </Field>
      </Section>

      {canEdit ? (
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft({});
              setErrors({});
            }}
          >
            Reset
          </Button>
          <Button variant="brand" className="gap-1.5" disabled={save.isPending} onClick={submit}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Editing needs the &quot;settings · edit&quot; permission.
        </p>
      )}
    </div>
  );
}
