import { type Address, type Conversation, type Message } from '@bitcrm/types';
import { formatDate, formatTime, splitTimeSlot } from '../templates/date-format';

/**
 * What a technician reads on a lock screen, at arm's length, in a van.
 *
 * The rule from the parity requirement is that the wording is Workiz's: a
 * job notification is titled after the job number, because that is what a
 * technician scans for (the same reason `emailSubject` in
 * `send-to-tech.service.ts` uses it), and the body answers the only two
 * questions a job raises before it is opened — when, and where. Ids,
 * conversation keys and channel names never appear: they live in the
 * payload's `data`, which is for the app, not the person.
 */

/** A lock screen shows roughly two lines; past this the tail is never read. */
export const PUSH_BODY_MAX = 140;

/** The middle dot reads as a separator at a glance, and costs one character. */
const SEP = ' · ';

export interface JobPushDeal {
  dealNumber?: string;
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  address?: Address;
}

/** `New job #A3F9K2` — the number is the handle, not jargon. */
export function jobPushTitle(deal: JobPushDeal): string {
  return deal.dealNumber ? `New job #${deal.dealNumber}` : 'New job';
}

/** `Sep 22, 2026 · 9:00 AM–12:00 PM · 128 Main St, Hartford`, minus whatever the job has not got. */
export function jobPushBody(deal: JobPushDeal, timezone: string): string {
  const parts = [formatDate(deal.scheduledDate, timezone), timeRange(deal.scheduledTimeSlot, timezone), shortAddress(deal.address)];
  const body = parts.filter(Boolean).join(SEP);
  // An unscheduled job with no address still has to say something a person
  // can act on — "New job" alone on a lock screen looks like a bug.
  return body || 'Tap to open the job';
}

/** `9:00 AM–12:00 PM`, or just the start when the slot has no end. */
export function timeRange(slot: string | undefined, timezone: string): string | undefined {
  const { start, end } = splitTimeSlot(slot);
  const from = formatTime(start, timezone);
  if (!from) return undefined;
  const to = formatTime(end, timezone);
  return to ? `${from}–${to}` : from;
}

/** Street and city — the two lines of an address a driver needs before they open the job. */
export function shortAddress(address: Address | undefined): string | undefined {
  if (!address) return undefined;
  const street = [address.street, address.unit].filter(Boolean).join(' ').trim();
  return [street, address.city?.trim()].filter(Boolean).join(', ') || undefined;
}

/**
 * Who the message is from, as the recipient would name them: a group is its
 * own name, a 1:1 thread is the person who wrote. "Office" is the fallback
 * for a line the office sent under no particular name — which is what a
 * technician calls it anyway.
 */
export function messagePushTitle(message: Message, conversation: Conversation): string {
  if (conversation.kind === 'group') return conversation.name?.trim() || 'Team chat';
  return message.sentByName?.trim() || 'Office';
}

/** The text itself, trimmed; an attachment-only line says what arrived. */
export function messagePushBody(message: Message, conversation: Conversation): string {
  const body = (message.body ?? '').replace(/\s+/g, ' ').trim();
  // In a group the sender's name is not in the title, so it goes in front of
  // the text — otherwise a busy thread reads as one anonymous voice.
  const prefix = conversation.kind === 'group' && message.sentByName ? `${message.sentByName.trim()}: ` : '';
  if (body) return clamp(`${prefix}${body}`);
  const count = message.attachments?.length ?? 0;
  if (count > 1) return clamp(`${prefix}Sent ${count} photos`);
  if (count === 1) return clamp(`${prefix}Sent a photo`);
  return clamp(`${prefix}Sent a message`);
}

/** Cut on a word, with an ellipsis, so the last word is never half a word. */
function clamp(text: string, max: number = PUSH_BODY_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
