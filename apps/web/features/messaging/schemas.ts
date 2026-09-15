import { z } from "zod";
import { MESSAGE_TEMPLATE_CHANNELS, SMS_BODY_MAX_LENGTH, type MessagingSettings } from "@bitcrm/types";
import { normalizePhone } from "@/lib/phone";
import type { MessageTemplateBody, MessagingSettingsBody } from "./api";

/* ------------------------------------------------------------- templates */

export const templateFormSchema = z.object({
  messageTemplateTitle: z.string().trim().min(1, "Give the template a title").max(120),
  messageTemplate: z.string().trim().min(1, "The template needs a body").max(10_000),
  messageSubjectTemplate: z.string().trim().max(250).default(""),
  channel: z.enum(MESSAGE_TEMPLATE_CHANNELS).default("sms"),
  category: z.string().trim().max(60).default(""),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export type TemplateFormValues = z.input<typeof templateFormSchema>;
export type TemplateFormOutput = z.output<typeof templateFormSchema>;

export function toTemplateBody(values: TemplateFormOutput): MessageTemplateBody {
  return {
    messageTemplateTitle: values.messageTemplateTitle,
    messageTemplate: values.messageTemplate,
    messageSubjectTemplate: values.channel === "sms" ? undefined : values.messageSubjectTemplate || undefined,
    channel: values.channel,
    category: values.category || undefined,
    isDefault: values.isDefault,
    active: values.active,
  };
}

/* -------------------------------------------------------------- settings */

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Empty is allowed everywhere — the server treats "" as "clear this field". */
const phoneOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === "" || normalizePhone(v) !== null, "Enter a valid phone number")
  .transform((v) => (v === "" ? "" : (normalizePhone(v) as string)));

const urlOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Enter an http(s) URL");

const emailOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email");

export function isIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timezoneOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === "" || isIanaTimezone(v), "Use an IANA zone like America/New_York");

export const messagingSettingsSchema = z
  .object({
    defaultSenderNumber: phoneOrEmpty,
    smsPre: z.string().max(160, "At most 160 characters"),
    signature: z.string().max(160, "At most 160 characters"),
    smsFormat: z.string().max(SMS_BODY_MAX_LENGTH),
    onMyWayMsg: z.string().max(SMS_BODY_MAX_LENGTH),
    lateMsg: z.string().max(SMS_BODY_MAX_LENGTH),
    onMyWayMsgNotify: z.boolean(),
    lateMsgNotify: z.boolean(),
    useCloseLink: z.boolean(),
    quietHoursEnabled: z.boolean(),
    quietFrom: z.string().trim(),
    quietTo: z.string().trim(),
    quietTimezone: timezoneOrEmpty,
    confirmLinkBaseUrl: urlOrEmpty,
    infoLinkBaseUrl: urlOrEmpty,
    stopReplyText: z.string().max(320, "At most 320 characters"),
    helpReplyText: z.string().max(320, "At most 320 characters"),
    companyName: z.string().trim().max(120),
    companyPhone: phoneOrEmpty,
    companyEmail: emailOrEmpty,
    timezone: timezoneOrEmpty,
  })
  .superRefine((v, ctx) => {
    if (!v.quietHoursEnabled) return;
    if (!HH_MM.test(v.quietFrom)) ctx.addIssue({ code: "custom", path: ["quietFrom"], message: "Use HH:mm" });
    if (!HH_MM.test(v.quietTo)) ctx.addIssue({ code: "custom", path: ["quietTo"], message: "Use HH:mm" });
    if (!v.quietTimezone) {
      ctx.addIssue({ code: "custom", path: ["quietTimezone"], message: "Quiet hours need a timezone" });
    }
  });

export type MessagingSettingsFormValues = z.input<typeof messagingSettingsSchema>;
export type MessagingSettingsFormOutput = z.output<typeof messagingSettingsSchema>;

export function settingsToForm(s: MessagingSettings | undefined): MessagingSettingsFormValues {
  return {
    defaultSenderNumber: s?.defaultSenderNumber ?? "",
    smsPre: s?.smsPre ?? "",
    signature: s?.signature ?? "",
    smsFormat: s?.smsFormat ?? "",
    onMyWayMsg: s?.onMyWayMsg ?? "",
    lateMsg: s?.lateMsg ?? "",
    onMyWayMsgNotify: s?.onMyWayMsgNotify ?? false,
    lateMsgNotify: s?.lateMsgNotify ?? false,
    useCloseLink: s?.useCloseLink ?? false,
    quietHoursEnabled: !!s?.quietHours,
    quietFrom: s?.quietHours?.from ?? "20:00",
    quietTo: s?.quietHours?.to ?? "08:00",
    quietTimezone: s?.quietHours?.timezone ?? s?.timezone ?? "",
    confirmLinkBaseUrl: s?.confirmLinkBaseUrl ?? "",
    infoLinkBaseUrl: s?.infoLinkBaseUrl ?? "",
    stopReplyText: s?.stopReplyText ?? "",
    helpReplyText: s?.helpReplyText ?? "",
    companyName: s?.companyName ?? "",
    companyPhone: s?.companyPhone ?? "",
    companyEmail: s?.companyEmail ?? "",
    timezone: s?.timezone ?? "",
  };
}

/**
 * The PUT body. Every text field is sent as typed ("" clears it on the
 * server); quiet hours go as one object, or are left alone when disabled
 * — the API has no "remove quiet hours", so disabling keeps the stored
 * window but the UI shows it off. Phones are E.164.
 */
export function toSettingsBody(v: MessagingSettingsFormOutput): MessagingSettingsBody {
  const body: MessagingSettingsBody = {
    smsPre: v.smsPre,
    signature: v.signature,
    smsFormat: v.smsFormat,
    onMyWayMsg: v.onMyWayMsg,
    lateMsg: v.lateMsg,
    onMyWayMsgNotify: v.onMyWayMsgNotify,
    lateMsgNotify: v.lateMsgNotify,
    useCloseLink: v.useCloseLink,
    confirmLinkBaseUrl: v.confirmLinkBaseUrl,
    infoLinkBaseUrl: v.infoLinkBaseUrl,
    stopReplyText: v.stopReplyText,
    helpReplyText: v.helpReplyText,
    companyName: v.companyName,
    companyEmail: v.companyEmail,
  };
  // The E.164 validators refuse "", so phones and zones go only when set.
  if (v.defaultSenderNumber) body.defaultSenderNumber = v.defaultSenderNumber;
  if (v.companyPhone) body.companyPhone = v.companyPhone;
  if (v.timezone) body.timezone = v.timezone;
  if (v.quietHoursEnabled) {
    body.quietHours = { from: v.quietFrom, to: v.quietTo, timezone: v.quietTimezone };
  }
  return body;
}
