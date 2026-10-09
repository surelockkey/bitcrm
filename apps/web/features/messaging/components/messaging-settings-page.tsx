"use client";

import { useState, type ReactNode } from "react";
import { SEND_TO_TECH_CHANNELS } from "@bitcrm/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzActionBar } from "@/components/workiz/layout";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzSectionRule } from "@/components/workiz/phone-tab-parts";
import { WzCheckbox } from "@/components/workiz/toggles";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { SEND_TO_TECH_CHANNEL_LABEL } from "@/features/deals/lib";
import { useNumbers } from "@/features/telephony/numbers-hooks";
import { formatPhone } from "@/lib/phone";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { useMessagingAccess, useMessagingSettings, useShortCodes, useTemplates, useUpdateMessagingSettings } from "../hooks";
import {
  messagingSettingsSchema,
  settingsToForm,
  toSettingsBody,
  type MessagingSettingsFormValues,
} from "../schemas";
import { countSegments } from "../segments";
import { TextTemplateField } from "./text-template-field";
import { MessageTemplatesSection } from "./templates-page";

type Errors = Partial<Record<keyof MessagingSettingsFormValues, string>>;

/** The short codes Workiz offers under On the Way and Running late (pg_settings_phone_wz_texting_scroll1). */
const ON_MY_WAY_CODES = ["first_name", "tech_assigned", "full_address"] as const;
const LATE_CODES = ["first_name", "late_value", "tech_assigned"] as const;

/** A Texting section's title: h5 16px/24px 600 ink. */
function SectionTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-base leading-6 font-semibold tracking-[0.4px] text-foreground">{children}</h2>
      {lead ? <p className="mt-2 text-sm leading-[21px] tracking-[0.4px] text-wz-slate">{lead}</p> : null}
    </div>
  );
}

/**
 * A Texting setting ("Caller ID", "Forward incoming messages"): its name
 * 13px/19px 600 ink, the 13px #566d76 words 8px under it, then 24px down
 * the control; 32px to the next one.
 */
function Setting({ title, hint, className, children }: { title: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn("mb-8 last:mb-0", className)}>
      <p className="text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-foreground">{title}</p>
      {hint ? <p className="mt-2 text-[13px] leading-[19px] tracking-[0.4px] text-wz-slate">{hint}</p> : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** Under a checkbox: the 13px #566d76 words Workiz puts under "Enable Job Closing". */
function CheckHint({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] leading-[19px] tracking-[0.4px] text-wz-slate">{children}</p>;
}

/**
 * Workiz Phone → Texting (`/calls/texting`; Settings → Text Messages lands
 * here, as Workiz's /root/sms_settings does): one 568px column, 40px in —
 * "Messaging compliance", "Messaging settings", "Text templates" — and
 * "Save Settings" in the white bar at the bottom
 * (pg_settings_phone_wz_texting). Workiz's sections hold ours: STOP / HELP
 * replies are compliance; the sender, prefix and signature, job closing
 * (Workiz's "Enable Job Closing" is our close-job link), Send to tech, quiet
 * hours and links are messaging settings; the tech texts are Workiz's three
 * text templates, and our message templates (Workiz's quick replies) follow
 * them. Business profile — the values of {{biz_name}} and co. — is ours,
 * after the rest. A reader who may see templates but not settings sees the
 * templates alone.
 */
export function MessagingSettingsPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const denied = useDenied();
  const { canViewTemplates } = useMessagingAccess();
  const canSettings = can("settings");
  const canEdit = can("settings", "edit");
  const settingsQuery = useMessagingSettings(canSettings);
  const numbersQuery = useNumbers(canSettings);
  const codesQuery = useShortCodes(canSettings);
  // The templates under Text templates come in the same frame (the section
  // asks with the same hook, so it finds them here).
  const templatesQuery = useTemplates({ includeInactive: true }, canViewTemplates);
  const { data: settings } = settingsQuery;
  const { data: numbers } = numbersQuery;
  // The form waits for the numbers too: drawn first, the default sender was
  // a free-text box that turned into the number picker when they came.
  const ready = usePageReady(
    !permissionsLoading && [settingsQuery, numbersQuery, codesQuery, templatesQuery].every(settled),
  );
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
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value as MessagingSettingsFormValues[typeof key]),
    disabled: !canEdit,
    error: errors[key],
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

  // Refused only once the permissions say so — not while they are coming.
  const settingsDenied = denied("settings");
  if (settingsDenied && !permissionsLoading && !canViewTemplates) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view settings.</p>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="px-10 pt-10">
        <Skeleton className="h-96 w-full max-w-[568px]" />
      </div>
    );
  }

  if (!canSettings) {
    return (
      <div className="px-10 pt-10 pb-10">
        <div className="w-[568px] max-w-full">
          <SectionTitle lead="Set up text templates that are sent to you and your customers">Text templates</SectionTitle>
          <MessageTemplatesSection />
        </div>
      </div>
    );
  }

  const prefixSegments = countSegments(form.smsPre + form.signature);
  const allCodes = (codesQuery.data ?? []).map((c) => c.code);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 px-10 pt-10 pb-10">
        <div className="w-[568px] max-w-full">
          <SectionTitle>Messaging compliance</SectionTitle>
          <Setting
            title="STOP and HELP replies"
            hint="Twilio answers these itself on the Messaging Service; these are what BitCRM sends when it has to. HELP must name the company and a phone."
          >
            <div className="flex flex-col gap-6">
              <TextTemplateField
                label="After STOP"
                rows={2}
                value={form.stopReplyText}
                onChange={(v) => set("stopReplyText", v)}
                codes={[]}
                error={errors.stopReplyText}
                disabled={!canEdit}
              />
              <TextTemplateField
                label="After HELP"
                rows={2}
                value={form.helpReplyText}
                onChange={(v) => set("helpReplyText", v)}
                codes={[]}
                error={errors.helpReplyText}
                disabled={!canEdit}
              />
            </div>
          </Setting>

          <WzSectionRule />
          <SectionTitle>Messaging settings</SectionTitle>
          <Setting title="Sender" hint="The last rung of the sender chain — used when no better number matches the client or the job.">
            {numbers && numbers.length > 0 ? (
              <Select
                value={form.defaultSenderNumber || "none"}
                onValueChange={(v) => set("defaultSenderNumber", v === "none" ? "" : v)}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-10 w-full" aria-label="Default number">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {numbers.map((n) => (
                    <SelectItem key={n.sid} value={n.phoneNumber}>
                      {formatPhone(n.phoneNumber)}
                      {n.friendlyName && n.friendlyName !== n.phoneNumber ? ` · ${n.friendlyName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <WzOutlinedTextField label="Default number" placeholder="+1 202 555 0100" {...text("defaultSenderNumber")} />
            )}
            {errors.defaultSenderNumber && numbers && numbers.length > 0 ? (
              <p role="alert" className="mt-1 text-xs text-wz-error">
                {errors.defaultSenderNumber}
              </p>
            ) : null}
          </Setting>

          <Setting title="Text format" hint="Wrapped around every outbound SMS. Keep both short — they count against the segments.">
            <div className="grid grid-cols-2 gap-4">
              <WzOutlinedTextField label="Prefix" maxLength={160} {...text("smsPre")} />
              <WzOutlinedTextField label="Signature" maxLength={160} {...text("signature")} />
            </div>
            <p className="mt-2 pl-3 text-xs leading-[18px] tracking-[0.4px] text-foreground">
              Prefix + signature: {prefixSegments.units} {prefixSegments.encoding} characters of every message.
            </p>
          </Setting>

          <div className="mb-8">
            <WzCheckbox
              label="Enable Job Closing"
              checked={form.useCloseLink}
              onCheckedChange={(v) => set("useCloseLink", v)}
              disabled={!canEdit}
            />
            <CheckHint>Adds the close-job link to the Job Text Message, so your techs can close the job from it.</CheckHint>
          </div>

          {/* Workiz's "Send to tech" checkboxes: what a job page ticks before a
              dispatcher touches them. Clearing every box falls back to SMS. */}
          <Setting title="Send to tech" hint="What the job page’s “Send to tech” ticks before the dispatcher changes it.">
            <div className="flex flex-wrap items-center gap-6">
              {SEND_TO_TECH_CHANNELS.map((channel) => (
                <WzCheckbox
                  key={channel}
                  label={SEND_TO_TECH_CHANNEL_LABEL[channel]}
                  checked={form.sendToTechChannels.includes(channel)}
                  onCheckedChange={(v) =>
                    set(
                      "sendToTechChannels",
                      v
                        ? SEND_TO_TECH_CHANNELS.filter((c) => c === channel || form.sendToTechChannels.includes(c))
                        : form.sendToTechChannels.filter((c) => c !== channel),
                    )
                  }
                  disabled={!canEdit}
                />
              ))}
            </div>
          </Setting>

          <div className="mb-8">
            <WzCheckbox
              label="Quiet hours"
              aria-label="Quiet hours"
              checked={form.quietHoursEnabled}
              onCheckedChange={(v) => set("quietHoursEnabled", v)}
              disabled={!canEdit}
            />
            <CheckHint>Automations hold non-urgent texts overnight in this window; manual sends only warn.</CheckHint>
            <div className={cn("mt-6 grid grid-cols-3 gap-4", !form.quietHoursEnabled && "opacity-60")}>
              <WzOutlinedTextField label="From" placeholder="20:00" {...text("quietFrom")} disabled={!canEdit || !form.quietHoursEnabled} />
              <WzOutlinedTextField label="To" placeholder="08:00" {...text("quietTo")} disabled={!canEdit || !form.quietHoursEnabled} />
              <WzOutlinedTextField
                label="Timezone"
                placeholder="America/New_York"
                {...text("quietTimezone")}
                disabled={!canEdit || !form.quietHoursEnabled}
              />
            </div>
          </div>

          <Setting
            title="Links"
            hint="Bases of {{confirm_link}} and {{info_link}}; {{deal_id}} inside the URL is substituted, otherwise /<id> is appended."
          >
            <div className="flex flex-col gap-6">
              <WzOutlinedTextField label="Confirm link" placeholder="https://book.example.com/confirm" {...text("confirmLinkBaseUrl")} />
              <WzOutlinedTextField label="Job info link" placeholder="https://book.example.com/job/{{deal_id}}" {...text("infoLinkBaseUrl")} />
            </div>
          </Setting>

          <WzSectionRule />
          <SectionTitle lead="Set up text templates that are sent to you and your customers">Text templates</SectionTitle>
          <TextTemplateField
            label="Job Text Message"
            info="What a technician gets when a job is sent to them."
            value={form.smsFormat}
            onChange={(v) => set("smsFormat", v)}
            codes={allCodes}
            helper="Clicking “Send to tech” on a job applies this template."
            error={errors.smsFormat}
            disabled={!canEdit}
          />
          <WzSectionRule />
          <TextTemplateField
            label="On the Way"
            info="Sent to the client when the technician taps On my way."
            value={form.onMyWayMsg}
            onChange={(v) => set("onMyWayMsg", v)}
            placeholder="Hi {{first_name}}, {{tech_assigned}} is on the way to you now."
            codes={ON_MY_WAY_CODES}
            error={errors.onMyWayMsg}
            disabled={!canEdit}
          >
            <WzCheckbox
              className="mt-4"
              label="Send “on my way” texts"
              aria-label="Send on-my-way texts"
              checked={form.onMyWayMsgNotify}
              onCheckedChange={(v) => set("onMyWayMsgNotify", v)}
              disabled={!canEdit}
            />
          </TextTemplateField>
          <WzSectionRule />
          <TextTemplateField
            label="Running late"
            info="Sent to the client when the technician says how late they are."
            value={form.lateMsg}
            onChange={(v) => set("lateMsg", v)}
            placeholder="Hi {{first_name}}, {{tech_assigned}} is running about {{late_value}} minutes late."
            codes={LATE_CODES}
            helper="{{late_value}} is the minutes."
            error={errors.lateMsg}
            disabled={!canEdit}
          >
            <WzCheckbox
              className="mt-4"
              label="Send “running late” texts"
              aria-label="Send running-late texts"
              checked={form.lateMsgNotify}
              onCheckedChange={(v) => set("lateMsgNotify", v)}
              disabled={!canEdit}
            />
          </TextTemplateField>
          {canViewTemplates ? (
            <>
              <WzSectionRule />
              <MessageTemplatesSection />
            </>
          ) : null}

          <WzSectionRule />
          <SectionTitle lead="What {{biz_name}}, {{biz_number}} and {{biz_email}} render as, and the zone for dates and times.">
            Business profile
          </SectionTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            <WzOutlinedTextField label="Company name" {...text("companyName")} />
            <WzOutlinedTextField label="Company phone" placeholder="+1 202 555 0100" {...text("companyPhone")} />
            <WzOutlinedTextField label="Company email" placeholder="office@example.com" {...text("companyEmail")} />
            <WzOutlinedTextField label="Timezone" placeholder="America/New_York" {...text("timezone")} />
          </div>
          <p className="mt-2 pl-3 text-xs leading-[18px] tracking-[0.4px] text-foreground">
            The company phone falls back to the default number; a job&apos;s own zone wins over this one.
          </p>
          {!canEdit ? (
            <p className="mt-8 text-xs text-wz-slate">Editing needs the &quot;settings · edit&quot; permission.</p>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <WzActionBar className="sticky bottom-0 mt-auto">
          <WzButton
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft({});
              setErrors({});
            }}
          >
            Reset
          </WzButton>
          <WzButton disabled={!dirty} loading={save.isPending} onClick={submit} className="min-w-[140px]">
            Save Settings
          </WzButton>
        </WzActionBar>
      ) : null}
    </div>
  );
}
