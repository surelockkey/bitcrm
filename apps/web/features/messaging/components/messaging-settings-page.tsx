"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/features/auth/use-permissions";
import { useNumbers } from "@/features/telephony/numbers-hooks";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useMessagingSettings, useUpdateMessagingSettings } from "../hooks";
import {
  messagingSettingsSchema,
  settingsToForm,
  toSettingsBody,
  type MessagingSettingsFormValues,
} from "../schemas";
import { countSegments } from "../segments";

type Errors = Partial<Record<keyof MessagingSettingsFormValues, string>>;

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

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Settings → Messaging: sender, prefix / signature, tech texts, quiet hours, links, STOP/HELP, business profile. */
export function MessagingSettingsPage() {
  const { can } = usePermissions();
  const canEdit = can("settings", "edit");
  const { data: settings, isLoading } = useMessagingSettings(can("settings"));
  const { data: numbers } = useNumbers(can("settings"));
  const save = useUpdateMessagingSettings();

  // The form is the server document with the user's edits laid over it:
  // no copy to keep in sync, and a fresh document never clobbers a draft.
  const [draft, setDraft] = useState<Partial<MessagingSettingsFormValues>>({});
  const [errors, setErrors] = useState<Errors>({});
  const form: MessagingSettingsFormValues = { ...settingsToForm(settings), ...draft };
  const dirty = Object.keys(draft).length > 0;

  const set = <K extends keyof MessagingSettingsFormValues>(key: K, value: MessagingSettingsFormValues[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const text = (key: keyof MessagingSettingsFormValues) => ({
    value: String(form[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key, e.target.value as MessagingSettingsFormValues[typeof key]),
    disabled: !canEdit,
  });

  const submit = () => {
    const parsed = messagingSettingsSchema.safeParse(form);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof MessagingSettingsFormValues;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(toSettingsBody(parsed.data), { onSuccess: () => setDraft({}) });
  };

  if (!can("settings")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view settings.</p>
      </div>
    );
  }
  if (isLoading) return <Skeleton className="h-96 w-full max-w-3xl" />;

  const smsPre = countSegments(form.smsPre + form.signature);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Messaging</h2>
        <p className="text-sm text-muted-foreground">
          How texts leave the workspace: the number they come from, what wraps them, the automatic ones, and the
          business behind the short codes.
        </p>
      </div>

      <Section title="Sender" hint="The last rung of the sender chain — used when no better number matches the client or the job.">
        <Field label="Default number" error={errors.defaultSenderNumber}>
          {numbers && numbers.length > 0 ? (
            <Select value={form.defaultSenderNumber || "none"} onValueChange={(v) => set("defaultSenderNumber", v === "none" ? "" : v)} disabled={!canEdit}>
              <SelectTrigger className="h-9 w-full sm:w-72" aria-label="Default number">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {numbers.map((n) => (
                  <SelectItem key={n.sid} value={n.phoneNumber}>
                    {formatPhone(n.phoneNumber)}{n.friendlyName && n.friendlyName !== n.phoneNumber ? ` · ${n.friendlyName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input className="h-9 sm:w-72" placeholder="+1 202 555 0100" {...text("defaultSenderNumber")} />
          )}
        </Field>
      </Section>

      <Section title="Text format" hint="Wrapped around every outbound SMS. Keep both short — they count against the segments.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prefix" error={errors.smsPre} hint="Before the body (Workiz sms_pre).">
            <Input className="h-9" maxLength={160} {...text("smsPre")} />
          </Field>
          <Field label="Signature" error={errors.signature} hint="After the body.">
            <Input className="h-9" maxLength={160} {...text("signature")} />
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Prefix + signature: {smsPre.units} {smsPre.encoding} characters of every message.
        </p>
      </Section>

      <Section title="Technician texts" hint="Sent to the client on behalf of the tech; short codes allowed.">
        <Field label="New job text to technicians" error={errors.smsFormat} hint="Workiz sms_format — what a tech gets when a job is assigned.">
          <Textarea rows={3} {...text("smsFormat")} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.useCloseLink} onCheckedChange={(v) => set("useCloseLink", v)} disabled={!canEdit} aria-label="Include the close-job link" />
          Include the close-job link in the new job text
        </label>
        <Field label="On my way" error={errors.onMyWayMsg}>
          <Textarea rows={2} {...text("onMyWayMsg")} placeholder="Hi {{first_name}}, {{tech_name}} is on the way to you now." />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.onMyWayMsgNotify} onCheckedChange={(v) => set("onMyWayMsgNotify", v)} disabled={!canEdit} aria-label="Send on-my-way texts" />
          Send &quot;on my way&quot; texts
        </label>
        <Field label="Running late" error={errors.lateMsg} hint="{{late_value}} is the minutes.">
          <Textarea rows={2} {...text("lateMsg")} placeholder="Hi {{first_name}}, {{tech_name}} is running about {{late_value}} minutes late." />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.lateMsgNotify} onCheckedChange={(v) => set("lateMsgNotify", v)} disabled={!canEdit} aria-label="Send running-late texts" />
          Send &quot;running late&quot; texts
        </label>
      </Section>

      <Section title="Quiet hours" hint="Automations hold non-urgent texts in this window; manual sends only warn.">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.quietHoursEnabled} onCheckedChange={(v) => set("quietHoursEnabled", v)} disabled={!canEdit} aria-label="Quiet hours" />
          Hold automated texts overnight
        </label>
        <div className={cn("grid gap-3 sm:grid-cols-3", !form.quietHoursEnabled && "opacity-60")}>
          <Field label="From" error={errors.quietFrom}>
            <Input className="h-9" placeholder="20:00" {...text("quietFrom")} disabled={!canEdit || !form.quietHoursEnabled} />
          </Field>
          <Field label="To" error={errors.quietTo}>
            <Input className="h-9" placeholder="08:00" {...text("quietTo")} disabled={!canEdit || !form.quietHoursEnabled} />
          </Field>
          <Field label="Timezone" error={errors.quietTimezone}>
            <Input className="h-9" placeholder="America/New_York" {...text("quietTimezone")} disabled={!canEdit || !form.quietHoursEnabled} />
          </Field>
        </div>
      </Section>

      <Section title="Links" hint="Bases of {{confirm_link}} and {{info_link}}; {{deal_id}} inside the URL is substituted, otherwise /<id> is appended.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Confirm link" error={errors.confirmLinkBaseUrl}>
            <Input className="h-9" placeholder="https://book.example.com/confirm" {...text("confirmLinkBaseUrl")} />
          </Field>
          <Field label="Job info link" error={errors.infoLinkBaseUrl}>
            <Input className="h-9" placeholder="https://book.example.com/job/{{deal_id}}" {...text("infoLinkBaseUrl")} />
          </Field>
        </div>
      </Section>

      <Section title="STOP and HELP replies" hint="Twilio answers these itself on the Messaging Service; these are what BitCRM sends when it has to. HELP must name the company and a phone.">
        <Field label="After STOP" error={errors.stopReplyText}>
          <Textarea rows={2} maxLength={320} {...text("stopReplyText")} />
        </Field>
        <Field label="After HELP" error={errors.helpReplyText}>
          <Textarea rows={2} maxLength={320} {...text("helpReplyText")} />
        </Field>
      </Section>

      <Section title="Business profile" hint="What {{biz_name}}, {{biz_number}} and {{biz_email}} render as, and the zone for dates and times.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" error={errors.companyName}>
            <Input className="h-9" {...text("companyName")} />
          </Field>
          <Field label="Company phone" error={errors.companyPhone} hint="Falls back to the default number.">
            <Input className="h-9" placeholder="+1 202 555 0100" {...text("companyPhone")} />
          </Field>
          <Field label="Company email" error={errors.companyEmail}>
            <Input className="h-9" placeholder="office@example.com" {...text("companyEmail")} />
          </Field>
          <Field label="Timezone" error={errors.timezone} hint="A job's own zone wins when it has one.">
            <Input className="h-9" placeholder="America/New_York" {...text("timezone")} />
          </Field>
        </div>
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
          <Button variant="brand" className="gap-1.5" disabled={!dirty || save.isPending} onClick={submit}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Editing needs the &quot;settings · edit&quot; permission.</p>
      )}
    </div>
  );
}
