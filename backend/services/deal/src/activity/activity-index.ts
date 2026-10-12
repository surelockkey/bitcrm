import {
  AccountClock,
  DEFAULT_TIMEZONE,
  TimelineEventType,
  wallClockInstant,
  zoneAbbr,
  zoneOffsetMs,
  type ActivityRow,
  type ActivitySource,
} from '@bitcrm/types';
import {
  activityActorPk,
  activityDayPk,
  activitySk,
  UNFILTERABLE_ACTORS,
} from './activity.constants';

/**
 * Which timeline rows are Activity events, what their index keys are and how
 * they read as a row of the report — pure, so the timeline writer, the
 * backfill and the verification script all apply the same rules.
 */

type Item = Record<string, unknown>;

interface WorkizDetails {
  text?: string;
  jobUuid?: string;
  jobSerial?: number | string;
  native?: boolean;
  doneByAI?: boolean;
}

const workizOf = (item: Item): WorkizDetails | undefined => {
  const details = item.details as { workiz?: WorkizDetails } | undefined;
  return details?.workiz;
};

/** Came over from Workiz (the import stamps `source: workiz`). */
export function isImported(item: Item): boolean {
  const details = item.details as { source?: unknown } | undefined;
  return item.source === 'workiz' || details?.source === 'workiz';
}

/**
 * An Activity event: every native timeline event — our own job notes
 * included ("Added note: …", searchable; BitCRM's report listed them before
 * the Workiz pass and does again) — and of the imported rows only Workiz's
 * own activity log: not its job comments (`workiz:note:*`, Workiz lists those
 * elsewhere) nor the synthetic "created" rows the import adds
 * (`workiz:timeline:*`). This is what makes 1–27 Sep 2026 count exactly
 * Workiz's 130,964.
 */
export function isActivityItem(item: Item): boolean {
  const sk = typeof item.SK === 'string' ? item.SK : '';
  if (!sk.startsWith('TIMELINE#') && !sk.startsWith('ACT#')) return false;
  if (typeof item.timestamp !== 'string' || typeof item.id !== 'string') return false;
  if (isImported(item)) {
    return typeof item.externalId === 'string' && item.externalId.startsWith('workiz:activity:');
  }
  return true;
}

/** The job code an event is about, as the Job Id column prints it. */
export function activityJobRef(item: Item): string | undefined {
  const uuid = workizOf(item)?.jobUuid;
  return typeof uuid === 'string' && uuid ? uuid : undefined;
}

/**
 * The statuses as Workiz's Activity spells them (its log, Jul–Sep 2026):
 * "In progress" and "done pending approval", not our labels' casing.
 */
const WORKIZ_STATUS: Record<string, string> = {
  submitted: 'Submitted',
  in_progress: 'In progress',
  done: 'Done',
  pending: 'Pending',
  done_pending_approval: 'done pending approval',
  canceled: 'Canceled',
};

const CHANNEL_LABEL: Record<string, string> = { sms: 'SMS', email: 'Email', in_app: 'In App' };

/** "SMS & Email" — Workiz joins the channels of one send with " & ". */
const channelsText = (channels: unknown[]): string =>
  channels.map((c) => CHANNEL_LABEL[String(c)] ?? humanize(c)).join(' & ');

/** How a payment's method reads after "Added payment 349.89 in …" (Workiz: Cash, Check, Credit charge). */
const PAYMENT_METHOD: Record<string, string> = {
  card: 'Credit charge',
  cash: 'Cash',
  check: 'Check',
  bank: 'Bank transfer',
  other: 'Other',
};

/** …and after "Deleted payment 433 …" (Workiz: cash, check, credit — only offline payments are deleted). */
const DELETED_METHOD: Record<string, string> = { card: 'credit', cash: 'cash', check: 'check', bank: 'bank', other: 'other' };

const humanize = (v: unknown): string => {
  const s = typeof v === 'string' ? v.replace(/_/g, ' ') : String(v ?? '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** "150.00" — Workiz's prices and received amounts, two decimals, no "$". */
const fixed = (v: unknown): string => {
  const n = num(v);
  return n === undefined ? '' : n.toFixed(2);
};

/** "433", "378.81" — Workiz prints deleted and refunded amounts as they are. */
const plain = (v: unknown): string => {
  const n = num(v);
  return n === undefined ? '' : String(n);
};

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

const SCHEDULE_FIELDS = new Set(['scheduledDate', 'scheduledEndDate', 'scheduledTimeSlot', 'allDay']);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "18:00" → "6:00 pm". */
function clock(hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "Thu Oct 08 2026" of a `YYYY-MM-DD`. */
function dayText(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return `${WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${MONTHS[mo - 1]} ${m[3]} ${y}`;
}

/** `date` + "HH:MM" on `timeZone`'s clock → the same moment on Connecticut's: its day, its "HH:MM", its zone. */
function onOfficeClock(date: string, hhmm: string, timeZone: string): { date: string; time: string; abbr: string } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(date.slice(0, 10))) return null;
  let at: Date;
  try {
    at = wallClockInstant(date.slice(0, 10), `${pad2(Number(m[1]))}:${m[2]}`, timeZone);
  } catch {
    return null;
  }
  if (Number.isNaN(at.getTime())) return null;
  const wall = new Date(at.getTime() + zoneOffsetMs(at.getTime(), DEFAULT_TIMEZONE)).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16), abbr: zoneAbbr(at, DEFAULT_TIMEZONE) };
}

/**
 * A visit as Workiz's log writes it: "Thu Oct 08 2026 6:00 pm - 7:00 pm" (the
 * day alone when it is all-day or has no slot), "Unscheduled" without a day.
 * The web's `workizScheduleText` says the same.
 *
 * A visit written with its clock (`timezone`, 2026-10-12 on) is read onto
 * Connecticut's — the office's — and says its zone: a Chicago 8:00 is
 * "9:00 am - 10:00 am EDT". One written before carries no zone and reads as
 * it always did (stored rows are never rewritten).
 */
export function workizVisitText(v: unknown): string {
  const visit = (v && typeof v === 'object' ? v : {}) as { date?: unknown; slot?: unknown; allDay?: unknown; timezone?: unknown };
  const day = typeof visit.date === 'string' ? dayText(visit.date) : null;
  if (!day) return 'Unscheduled';
  if (visit.allDay === true || typeof visit.slot !== 'string' || !visit.slot) return day;
  const [start, end] = visit.slot.split('-');
  if (typeof visit.timezone === 'string' && visit.timezone && start && end) {
    const from = onOfficeClock(visit.date as string, start, visit.timezone);
    const to = onOfficeClock(visit.date as string, end, visit.timezone);
    const officeDay = from && dayText(from.date);
    if (from && to && officeDay) {
      return `${officeDay} ${clock(from.time)} - ${clock(to.time)}${from.abbr ? ` ${from.abbr}` : ''}`;
    }
  }
  const [a, b] = [start, end].map((t) => (t ? clock(t) : null));
  return a && b ? `${day} ${a} - ${b}` : day;
}

/** "Status Updated - Canceled - Cant Do - tech said cant do"; no sub-status → "Status Updated - Done - ". */
function statusText(d: Item): string {
  const to = typeof d.toStatus === 'string' ? WORKIZ_STATUS[d.toStatus] ?? humanize(d.toStatus) : '';
  if (!to) return 'Status Updated';
  const sub = text(d.subStatusName);
  const reason = text(d.cancellationReason);
  const parts = ['Status Updated', to, sub || reason];
  // A Canceled sub-status is the reason when none was typed — said once.
  if (sub && reason && reason !== sub) parts.push(reason);
  return parts.join(' - ');
}

/** Workiz writes one line per tag move: "Added tag", "Added tag(s)", "Remove tag from job", "Updated tags". */
function tagsText(d: Item): string {
  const before = ids(d.oldValue);
  const after = ids(d.newValue);
  const added = after.filter((t) => !before.includes(t)).length;
  const removed = before.filter((t) => !after.includes(t)).length;
  if (added && !removed) return added > 1 ? 'Added tag(s)' : 'Added tag';
  if (removed && !added) return 'Remove tag from job';
  return 'Updated tags';
}

/** "Added item Parts (35.00)" / "Removed item …" — the line's price when the entry carries it. */
function itemText(verb: string, d: Item): string {
  const name = text(d.productName);
  if (!name) return `${verb} item`;
  const price = fixed(d.priceClient);
  return price ? `${verb} item ${name} (${price})` : `${verb} item ${name}`;
}

/**
 * The Action column for one of our own events, in Workiz's words — read off
 * its live log ("Created Job", "Status Updated - In progress - Job Accepted",
 * "Added item Parts (35.00)", "Added payment 349.89 in Cash", "Sent to tech
 * by SMS") — built from the event type and its details, so it needs no lookups.
 */
export function nativeActivityText(eventType: string, details: Item = {}, note?: string): string {
  const d = details;
  switch (eventType) {
    case TimelineEventType.CREATED:
      return 'Created Job';
    case TimelineEventType.STATUS_CHANGED:
      return statusText(d);
    case TimelineEventType.STAGE_CHANGED:
      return d.toStage ? `Stage Updated - ${humanize(d.toStage)}` : 'Stage Updated';
    case TimelineEventType.FIELD_UPDATED: {
      const field = typeof d.field === 'string' ? d.field : '';
      // One save's reschedule, written as one entry with the whole visit before and after.
      if (field === 'schedule') return `Rescheduled job from ${workizVisitText(d.oldValue)} to ${workizVisitText(d.newValue)}`;
      // Rows written before that: one per field of the visit, the visit itself unknown.
      if (SCHEDULE_FIELDS.has(field)) return 'Rescheduled job';
      if (field === 'jobName') return 'Job name changed';
      if (field === 'tagIds') return tagsText(d);
      if (field === 'paymentStatus') return `Payment status updated - ${humanize(d.newValue)}`;
      if (field === 'assignedTechIds') return 'Team updated';
      return 'Update job details';
    }
    case TimelineEventType.NOTE_ADDED:
      return note ? `Added note: ${note}` : 'Added note';
    // The technician as named when the event was written (`techName`, Workiz's whole name).
    case TimelineEventType.TECH_ASSIGNED:
      return text(d.techName) ? `Tech Assigned - ${text(d.techName)}` : 'Tech Assigned';
    case TimelineEventType.TECH_UNASSIGNED:
      return text(d.techName) ? `Tech Unassigned - ${text(d.techName)}` : 'Tech Unassigned';
    case TimelineEventType.PRODUCT_ADDED:
      return itemText('Added', d);
    case TimelineEventType.PRODUCT_UPDATED: {
      // Workiz logs a price change on a line; any other edit is its generic "Update job details".
      const change = (d.changes as { priceClient?: { from?: unknown; to?: unknown } } | undefined)?.priceClient;
      const name = text(d.productName);
      if (change && name && fixed(change.from) && fixed(change.to)) {
        return `Item price updated: ${name} — ${fixed(change.from)} → ${fixed(change.to)}`;
      }
      return 'Update job details';
    }
    case TimelineEventType.PRODUCT_REMOVED:
      return itemText('Removed', d);
    case TimelineEventType.CALL_LINKED:
      return 'Call linked to job';
    case TimelineEventType.CALL_UNLINKED:
      return 'Call unlinked from job';
    case TimelineEventType.TECH_CONFIRMED:
      return 'Confirmed job receipt';
    case TimelineEventType.TECH_ARRIVED:
      return 'Arrived at location';
    // Workiz's line for the client's {{confirm_link}} tap (written with no user).
    case TimelineEventType.CLIENT_CONFIRMED:
      return 'Client Confirmed job';
    case TimelineEventType.ATTACHMENT_ADDED:
      return 'Saved Attachment';
    case TimelineEventType.ATTACHMENT_RENAMED:
      return 'Renamed Attachment';
    case TimelineEventType.ATTACHMENT_REMOVED:
      return 'Deleted Attachment';
    case TimelineEventType.SENT_TO_TECH: {
      const channels = Array.isArray(d.channels) ? d.channels : [];
      return channels.length ? `Sent to tech by ${channelsText(channels)}` : 'Sent to tech';
    }
    case TimelineEventType.SEEN_BY_TECH:
      return 'Viewed job in app';
    case TimelineEventType.TAX_CHANGED:
      return 'Tax updated';
    case TimelineEventType.DISCOUNT_CHANGED:
      return 'Discount updated';
    case TimelineEventType.INVOICE_CREATED:
      return text(d.number) ? `Created invoice #${text(d.number)}` : 'Created invoice';
    case TimelineEventType.INVOICE_UPDATED:
      return 'Updated invoice';
    case TimelineEventType.INVOICE_SENT:
      return 'Invoice Sent';
    case TimelineEventType.INVOICE_DELETED:
      return text(d.number) ? `Deleted invoice #${text(d.number)}` : 'Deleted invoice';
    case TimelineEventType.ESTIMATE_CREATED:
      return 'Created estimate';
    case TimelineEventType.ESTIMATE_STATUS_CHANGED: {
      if (d.signed) return 'Client signed estimate';
      const to = text(d.to) || text(d.status);
      if (to && text(d.number)) return `Updated estimate ${text(d.number)} status to ${humanize(to)}`;
      return to ? `Estimate status updated - ${humanize(to)}` : 'Estimate status updated';
    }
    case TimelineEventType.ESTIMATE_SENT:
      return 'Estimate Sent';
    // What the client did on the portal (or signed on the tech's phone) — Workiz says "Client …".
    case TimelineEventType.INVOICE_VIEWED:
      return 'Client viewed invoice';
    case TimelineEventType.ESTIMATE_VIEWED:
      return 'Client viewed estimate';
    case TimelineEventType.INVOICE_SIGNED:
      return 'Client signed invoice';
    case TimelineEventType.ESTIMATE_APPROVED:
      return 'Client signed estimate';
    case TimelineEventType.ESTIMATE_DECLINED:
      return 'Client declined estimate';
    case TimelineEventType.PROPOSAL_SENT:
      return 'Proposal Sent';
    case TimelineEventType.ESTIMATE_SYNCED:
      return 'Estimate synced to job';
    case TimelineEventType.ESTIMATE_DELETED:
      return 'Deleted estimate';
    case TimelineEventType.PAYMENT_RECEIVED: {
      const amount = fixed(d.amount);
      if (!amount) return 'Added payment';
      const method = text(d.method);
      return method ? `Added payment ${amount} in ${PAYMENT_METHOD[method] ?? humanize(method)}` : `Added payment ${amount}`;
    }
    case TimelineEventType.PAYMENT_PENDING:
      return 'Payment pending';
    case TimelineEventType.PAYMENT_FAILED:
      return 'Payment failed';
    case TimelineEventType.PAYMENT_REFUNDED: {
      const amount = plain(d.amount);
      // A mis-keyed offline payment is deleted, not refunded — Workiz: "Deleted payment 433 cash".
      if (d.deleted) {
        const method = text(d.method);
        const word = DELETED_METHOD[method] ?? method.replace(/_/g, ' ');
        return ['Deleted payment', amount, word].filter(Boolean).join(' ');
      }
      // Only a card payment is refunded (through the processor): "Refunded payment 109.54 charge".
      return amount ? `Refunded payment ${amount} charge` : 'Refunded payment';
    }
    case TimelineEventType.PAYMENT_REVERSED:
      return 'Payment reversed';
    default:
      return note || humanize(eventType);
  }
}

/** The Action column: Workiz's own text for an imported event, ours rendered for a native one. */
export function activityTextOf(item: Item): string {
  if (isImported(item)) {
    const text = workizOf(item)?.text;
    if (typeof text === 'string') return text;
    return typeof item.note === 'string' && item.eventType === 'workiz_activity' ? item.note : '';
  }
  return nativeActivityText(
    String(item.eventType ?? ''),
    (item.details as Item) ?? {},
    typeof item.note === 'string' ? item.note : undefined,
  );
}

/** Where the event was done — Workiz's `native` flag for an imported one. */
export function activitySourceOf(item: Item): ActivitySource | undefined {
  if (isImported(item)) return workizOf(item)?.native ? 'mobile' : 'web';
  const s = item.activitySource;
  return s === 'web' || s === 'mobile' || s === 'system' ? s : undefined;
}

/** What the search matches: the action text and the job code, lower-cased. */
export function activitySearchOf(item: Item): string {
  return [activityTextOf(item), activityJobRef(item)].filter(Boolean).join('\n').toLowerCase();
}

/**
 * The attributes that put a row into the Activity indexes, or null when it is
 * not an Activity event. `source` is recorded for a native event written now.
 */
export function activityIndexFields(
  item: Item,
  clock: AccountClock,
  source?: ActivitySource,
): Record<string, string> | null {
  if (!isActivityItem(item)) return null;
  const timestamp = item.timestamp as string;
  const id = item.id as string;
  const sk = activitySk(timestamp, id);
  const fields: Record<string, string> = {
    GSI8PK: activityDayPk(clock.day(timestamp)),
    GSI8SK: sk,
    activitySearch: activitySearchOf(item),
  };
  const actor = typeof item.actorId === 'string' ? item.actorId : '';
  if (!UNFILTERABLE_ACTORS.has(actor)) {
    fields.GSI9PK = activityActorPk(actor);
    fields.GSI9SK = sk;
  }
  if (source && !isImported(item)) fields.activitySource = source;
  return fields;
}

/** A stored row as the report prints it. `dealNumber` fills the Job Id of a native event. */
export function activityRowOf(item: Item, dealNumber?: string): ActivityRow {
  const imported = isImported(item);
  const w = workizOf(item);
  const sk = typeof item.SK === 'string' ? item.SK : '';
  const dealId = sk.startsWith('TIMELINE#') && typeof item.dealId === 'string' ? item.dealId : undefined;
  const source = activitySourceOf(item);
  return {
    id: String(item.id ?? ''),
    timestamp: String(item.timestamp ?? ''),
    actorId: String(item.actorId ?? ''),
    actorName: String(item.actorName ?? ''),
    imported,
    text: activityTextOf(item),
    ...(source && { source }),
    ...(w?.doneByAI && { doneByAI: true }),
    ...(dealId && { dealId }),
    ...((activityJobRef(item) ?? dealNumber) && { jobRef: activityJobRef(item) ?? dealNumber }),
  };
}
