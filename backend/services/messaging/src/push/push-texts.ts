import { type Message } from '@bitcrm/types';
import { type RenderContext } from '../templates/render-context';
import { resolveShortCode, visitTime } from '../templates/short-codes';
import { type PushData } from './push.constants';

/** One notification's words and the `data` the phone routes a tap on. */
export interface PushContent {
  title: string;
  body: string;
  data: PushData;
}

/** A message notification shows this much of the text. */
export const MESSAGE_PREVIEW_MAX = 140;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * When the visit is, as the technician reads it on the lock screen: "Fri Oct
 * 16, 10:00 AM CDT" — the stored wall clock on the JOB's clock with its
 * zone's name (owner, 2026-10-12: outside the office app a job's time is
 * told in the job's zone; `ctx.timezone` is what `ContextLoader` resolved).
 * "All day" for an all-day job, the day alone without a slot, "Unscheduled"
 * without a date.
 */
export function whenText(ctx: RenderContext): string {
  const date = DATE_ONLY.exec(ctx.deal?.scheduledDate ?? '');
  if (!date) return 'Unscheduled';
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])))
    .replace(',', '');
  const time = visitTime(ctx, 'start');
  return time ? `${day}, ${time}` : day;
}

/** The job's client as the job names them, else the CRM contact, else the client company. */
export function clientNameOf(ctx: RenderContext): string | undefined {
  return resolveShortCode('full_name', ctx) ?? (ctx.company?.title?.trim() || undefined);
}

const jobRef = (ctx: RenderContext) => (ctx.deal?.dealNumber ? `#${ctx.deal.dealNumber}` : 'Job');
const joined = (parts: Array<string | undefined>) => parts.filter(Boolean).join(' · ');
const jobData = (type: PushData['type'], ctx: RenderContext): PushData => ({ type, ...(ctx.deal?.id ? { dealId: ctx.deal.id } : {}) });

/** "New job assigned" — "Lockout #1042 · Jane Doe · Fri Oct 16, 10:00 AM CDT". */
export function jobAssignedPush(ctx: RenderContext): PushContent {
  const job = [ctx.deal?.jobTypeName?.trim() || 'Job', ctx.deal?.dealNumber ? `#${ctx.deal.dealNumber}` : undefined]
    .filter(Boolean)
    .join(' ');
  return { title: 'New job assigned', body: joined([job, clientNameOf(ctx), whenText(ctx)]), data: jobData('job_assigned', ctx) };
}

/** "Job rescheduled" — "#1042 moved to Sat Oct 17, 2:00 PM CDT". */
export function jobRescheduledPush(ctx: RenderContext): PushContent {
  return { title: 'Job rescheduled', body: `${jobRef(ctx)} moved to ${whenText(ctx)}`, data: jobData('job_rescheduled', ctx) };
}

/** "Job canceled" — "#1042 · Jane Doe". */
export function jobCanceledPush(ctx: RenderContext): PushContent {
  return { title: 'Job canceled', body: joined([jobRef(ctx), clientNameOf(ctx)]), data: jobData('job_canceled', ctx) };
}

/** "Removed from job" — "#1042". */
export function jobUnassignedPush(ctx: RenderContext): PushContent {
  return { title: 'Removed from job', body: jobRef(ctx), data: jobData('job_unassigned', ctx) };
}

/** `text` cut to `max` characters, an ellipsis included. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * What a message notification says: the text (whitespace folded) cut at
 * 140 characters; an email with no text says its subject, a bare photo
 * "Sent an attachment". `undefined` = nothing worth a notification.
 */
export function messagePreview(message: Message): string | undefined {
  const text = message.body?.replace(/\s+/g, ' ').trim();
  if (text) return truncate(text, MESSAGE_PREVIEW_MAX);
  const subject = message.channel === 'email' ? message.subject?.replace(/\s+/g, ' ').trim() : undefined;
  if (subject) return truncate(subject, MESSAGE_PREVIEW_MAX);
  if (message.attachments?.length) return 'Sent an attachment';
  return undefined;
}
