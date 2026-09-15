import type { Address } from '@bitcrm/types';
import { formatDate, formatTime, resolveTimezone, splitTimeSlot } from './date-format';
import type { RenderContext, RenderPerson } from './render-context';

/**
 * Short-code registry. Names are Workiz's, byte for byte, so the 39 imported
 * templates, the tech "on my way" / "late" texts and `sms_format` render
 * unchanged (`data/raw/settings_sms/short_codes_sms.json`, the client list in
 * `settings_notifications/_short_codes_client.json`). Custom fields are NOT
 * here: `{{<custom field name>}}` is resolved by the renderer from
 * `ctx.customFields`, which the loader keys by definition name.
 *
 * `GET /templates/short-codes` serves this list (plus the live custom-field
 * names) to the composer and the template editor.
 */
export type ShortCodeGroup = 'client' | 'job' | 'technician' | 'business' | 'links';

export interface ShortCodeDefinition {
  code: string;
  description: string;
  group: ShortCodeGroup;
  example: string;
  /** Older Workiz spelling of another code; both resolve identically. */
  aliasOf?: string;
}

type Resolver = (ctx: RenderContext) => string | undefined;

const join = (parts: Array<string | undefined>, sep: string) =>
  parts.map((p) => p?.trim()).filter(Boolean).join(sep) || undefined;

export const fullName = (p?: RenderPerson | { firstName?: string; lastName?: string }) =>
  p ? join([p.firstName, p.lastName], ' ') : undefined;

/** `+1XXXXXXXXXX` → `(XXX) XXX-XXXX`; anything else verbatim. */
export function formatPhone(e164?: string): string | undefined {
  if (!e164) return undefined;
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}

export const streetLine = (a?: Address) => (a ? join([a.street, a.unit], ' ') : undefined);

export const formatFullAddress = (a?: Address) =>
  a ? join([streetLine(a), a.city, join([a.state, a.zip], ' ')], ', ') : undefined;

/**
 * `{{confirm_link}}` / `{{info_link}}`: a base URL from settings with
 * `{{deal_id}}` / `{{job_id}}` substituted, else `/<dealId>` appended.
 * No deal, no link.
 */
export function buildLink(base: string | undefined, deal: RenderContext['deal']): string | undefined {
  if (!base || !deal?.id) return undefined;
  const dealId = encodeURIComponent(deal.id);
  const jobId = encodeURIComponent(deal.dealNumber ?? deal.id);
  if (/\{\{?\s*(deal_id|job_id)\s*\}?\}/.test(base)) {
    return base
      .replace(/\{\{?\s*deal_id\s*\}?\}/g, dealId)
      .replace(/\{\{?\s*job_id\s*\}?\}/g, jobId);
  }
  return `${base.replace(/\/+$/, '')}/${dealId}`;
}

const client = (ctx: RenderContext) => ctx.deal?.clientName ?? ctx.contact;
const jobAddress = (ctx: RenderContext) => ctx.deal?.address ?? ctx.contact?.addresses?.[0];
const zone = (ctx: RenderContext) =>
  resolveTimezone(ctx.timezone ?? ctx.deal?.jobTimezone ?? ctx.settings?.timezone ?? ctx.settings?.quietHours?.timezone);

const RESOLVERS: Record<string, Resolver> = {
  // --- client (party) ---
  full_name: (ctx) => fullName(client(ctx)),
  first_name: (ctx) => client(ctx)?.firstName?.trim() || undefined,
  last_name: (ctx) => client(ctx)?.lastName?.trim() || undefined,
  phone_number: (ctx) => formatPhone(ctx.contact?.phones?.[0]),
  client_email: (ctx) => ctx.contact?.emails?.[0],
  company_name: (ctx) => ctx.company?.title?.trim() || undefined,
  // --- job ---
  job_id: (ctx) => ctx.deal?.dealNumber,
  job_type: (ctx) => ctx.deal?.jobTypeName,
  job_date: (ctx) => formatDate(ctx.deal?.scheduledDate, zone(ctx)),
  appointment_time: (ctx) =>
    ctx.deal?.allDay ? 'All day' : formatTime(splitTimeSlot(ctx.deal?.scheduledTimeSlot).start, zone(ctx)),
  job_end_time: (ctx) =>
    ctx.deal?.allDay ? 'All day' : formatTime(splitTimeSlot(ctx.deal?.scheduledTimeSlot).end, zone(ctx)),
  full_address: (ctx) => formatFullAddress(jobAddress(ctx)),
  address: (ctx) => streetLine(jobAddress(ctx)),
  city: (ctx) => jobAddress(ctx)?.city?.trim() || undefined,
  state: (ctx) => jobAddress(ctx)?.state?.trim() || undefined,
  zip_code: (ctx) => jobAddress(ctx)?.zip?.trim() || undefined,
  description: (ctx) => ctx.deal?.notes?.trim() || undefined,
  ad_group: (ctx) => ctx.deal?.jobSourceName,
  referral_company_name: (ctx) => ctx.deal?.externalCompanyName,
  // --- technician ---
  tech_assigned: (ctx) => fullName(ctx.technician),
  tech_phone: (ctx) => formatPhone(ctx.technician?.phone),
  late_value: (ctx) => ctx.values?.late_value,
  // --- business ---
  biz_name: (ctx) => ctx.settings?.companyName?.trim() || undefined,
  biz_number: (ctx) => formatPhone(ctx.settings?.companyPhone || ctx.settings?.defaultSenderNumber),
  biz_email: (ctx) => ctx.settings?.companyEmail?.trim() || undefined,
  // --- links ---
  confirm_link: (ctx) => buildLink(ctx.settings?.confirmLinkBaseUrl, ctx.deal),
  info_link: (ctx) => buildLink(ctx.settings?.infoLinkBaseUrl, ctx.deal),
};

const def = (
  code: string,
  group: ShortCodeGroup,
  description: string,
  example: string,
  aliasOf?: string,
): ShortCodeDefinition => ({ code, group, description, example, ...(aliasOf ? { aliasOf } : {}) });

export const SHORT_CODES: readonly ShortCodeDefinition[] = [
  // Workiz `short_codes_sms.json` — the 22 standard codes, in its order.
  def('job_id', 'job', 'Job number shown to the client (deal number)', 'K4T9ZW'),
  def('full_name', 'client', "Client's full name (the job's client-name override wins)", 'Jane Doe'),
  def('first_name', 'client', "Client's first name", 'Jane'),
  def('last_name', 'client', "Client's last name", 'Doe'),
  def('company_name', 'client', "Client's company, when the contact belongs to one", 'Acme Property Mgmt'),
  def('phone_number', 'client', "Client's primary phone", '(404) 555-1234'),
  def('job_type', 'job', 'Job type name from the catalog', 'Lock change'),
  def('client_email', 'client', "Client's primary email", 'jane@example.com'),
  def('job_date', 'job', "Job's scheduled date", 'Sep 15, 2026'),
  def('appointment_time', 'job', 'Scheduled start time ("All day" for all-day jobs)', '2:30 PM'),
  def('job_end_time', 'job', 'Scheduled end time', '4:00 PM'),
  def('full_address', 'job', "Job address, one line (falls back to the client's address)", '12 Main St Apt 3, Atlanta, GA 30301'),
  def('address', 'job', 'Street and unit only', '12 Main St Apt 3'),
  def('city', 'job', 'City of the job address', 'Atlanta'),
  def('state', 'job', 'State of the job address', 'GA'),
  def('zip_code', 'job', 'ZIP of the job address', '30301'),
  def('tech_assigned', 'technician', "Assigned technician's name (the sender, when they are on the job)", 'Mike Smith'),
  def('description', 'job', 'Job notes / description', 'Rekey front and back doors'),
  def('confirm_link', 'links', 'Appointment confirmation link (base URL in settings)', 'https://book.example.com/confirm/…'),
  def('info_link', 'links', 'Job info link (base URL in settings)', 'https://book.example.com/job/…'),
  def('ad_group', 'job', 'Job source / ad group name', 'Google Ads'),
  def('referral_company_name', 'job', 'Referring external company', 'Roadside Partner LLC'),
  // Client list (`_short_codes_client.json`) extras.
  def('biz_name', 'business', 'Our business name (settings)', 'Sure Lock & Key'),
  def('biz_number', 'business', 'Our business phone (settings; default sender as fallback)', '(203) 403-6303'),
  def('biz_email', 'business', 'Our business email (settings)', 'office@example.com'),
  // Spellings the imported templates use.
  def('client_first_name', 'client', 'Same as first_name (used by the imported templates)', 'Jane', 'first_name'),
  def('client_last_name', 'client', 'Same as last_name', 'Doe', 'last_name'),
  def('client_client_company_name', 'client', 'Same as company_name', 'Acme Property Mgmt', 'company_name'),
  def('billing_location_key', 'job', 'Same as full_address (Workiz billing location)', '12 Main St Apt 3, Atlanta, GA 30301', 'full_address'),
  // Tech "late" template.
  def('late_value', 'technician', 'Minutes late — supplied by the sender of a "late" message', '15'),
  // BitCRM addition.
  def('tech_phone', 'technician', "Assigned technician's phone", '(404) 555-9876'),
];

const BY_CODE = new Map(SHORT_CODES.map((d) => [d.code, d]));

export const isKnownShortCode = (code: string): boolean => BY_CODE.has(code);

/** `undefined` when the code is unknown or its inputs are absent from the context. */
export function resolveShortCode(code: string, ctx: RenderContext): string | undefined {
  const definition = BY_CODE.get(code);
  if (!definition) return undefined;
  return RESOLVERS[definition.aliasOf ?? definition.code]?.(ctx);
}
