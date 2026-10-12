import { TimelineEventType } from "@bitcrm/types";
import type { SendToTechChannel, TimelineEntry } from "@bitcrm/types";
import { formatPhone } from "@/lib/phone";
import { formatDuration } from "@/features/calls/lib";
import { SEND_TO_TECH_CHANNEL_LABEL } from "./lib";

/**
 * What a row of the job's Timeline says, in the words Workiz's activity log
 * uses (rail_history): one plain line — "Created Job", "Update job details",
 * "Status Updated - Pending - NO ANSWER", "Rescheduled job from Thu Oct 08
 * 2026 8:30 am - 9:00 am to Thu Oct 08 2026 6:00 pm - 7:00 pm", "Tech
 * Assigned - (2) TX - Daniel Munoz". Where BitCRM knows more than Workiz
 * prints (which tag, which field, which file) it rides on the same line
 * after " - ", Workiz's own separator, or on a second line.
 *
 * The same words as the backend's Activity report (`nativeActivityText`), so
 * a job reads alike in both places.
 */

/** The catalogs a row needs to name things. */
export interface WordingLookups {
  userName: (id: unknown) => string | null;
  subStatuses: Map<string, string>;
  tags: Map<string, string>;
}

/**
 * Workiz's row icons: `lnr-laptop-phone` (done on the web), `lnr-smartphone`
 * (the mobile app), `lnr-note-pen`, `lnr-tel-outgoing` / `-incoming`,
 * `lnr-bubbles` for a message.
 */
export type RowIcon = "web" | "mobile" | "note" | "call-out" | "call-in" | "message";

export interface TimelineRowText {
  lines: string[];
  icon: RowIcon;
}

export interface WordingExtras {
  /** "Priority: Normal → Urgent" — the second line of an "Update job details". */
  fieldDetail?: (entry: TimelineEntry) => string | null;
  /** The job's client, named on a call ("Called Dustin Roselle"). */
  clientName?: string;
  /** The sentence `collapseReschedules` worked out for this row. */
  reschedule?: string;
}

interface WorkizStamp {
  text?: unknown;
  native?: unknown;
}

const workizOf = (e: TimelineEntry): WorkizStamp | undefined =>
  (e.details as { workiz?: WorkizStamp } | undefined)?.workiz;

/** Came over from Workiz (the import stamps `source: workiz`). */
export function isImportedEntry(e: TimelineEntry): boolean {
  return (e.details as { source?: unknown } | undefined)?.source === "workiz" || typeof workizOf(e)?.text === "string";
}

/** Done from a technician's phone: what only the app does. */
const MOBILE_EVENTS = new Set<string>([
  TimelineEventType.SEEN_BY_TECH,
  TimelineEventType.TECH_CONFIRMED,
  TimelineEventType.TECH_ARRIVED,
]);

const DOCUMENT_LABEL: Partial<Record<string, string>> = {
  [TimelineEventType.ESTIMATE_VIEWED]: "Client viewed estimate",
  [TimelineEventType.INVOICE_VIEWED]: "Client viewed invoice",
  [TimelineEventType.ESTIMATE_APPROVED]: "Client signed estimate",
  [TimelineEventType.ESTIMATE_DECLINED]: "Client declined estimate",
};

/** Workiz's plain words for the events that need no details. */
const PLAIN: Partial<Record<string, string>> = {
  [TimelineEventType.CREATED]: "Created Job",
  [TimelineEventType.SEEN_BY_TECH]: "Viewed job in app",
  [TimelineEventType.TECH_CONFIRMED]: "Confirmed job receipt",
  [TimelineEventType.TECH_ARRIVED]: "Arrived at location",
  [TimelineEventType.TAX_CHANGED]: "Tax updated",
  [TimelineEventType.DISCOUNT_CHANGED]: "Discount updated",
  [TimelineEventType.INVOICE_UPDATED]: "Updated invoice",
  [TimelineEventType.INVOICE_SENT]: "Invoice Sent",
  [TimelineEventType.INVOICE_DELETED]: "Deleted invoice",
  [TimelineEventType.ESTIMATE_SENT]: "Estimate Sent",
  [TimelineEventType.ESTIMATE_SYNCED]: "Estimate synced to job",
  [TimelineEventType.ESTIMATE_DELETED]: "Deleted estimate",
  [TimelineEventType.PROPOSAL_SENT]: "Proposal Sent",
  [TimelineEventType.PAYMENT_PENDING]: "Payment pending",
  [TimelineEventType.PAYMENT_FAILED]: "Payment failed",
  [TimelineEventType.PAYMENT_REVERSED]: "Payment reversed",
};

const humanize = (v: unknown): string => {
  const s = typeof v === "string" ? v.replace(/_/g, " ") : String(v ?? "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

/** "231.36", "125.00" — Workiz writes amounts without a currency sign. */
const amount = (v: unknown): string => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "";
};

/** "<head> - <what>", or just the head when there is nothing to name. */
const named = (head: string, what: string | null | undefined): string => (what ? `${head} - ${what}` : head);

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** "433", "378.81" — Workiz prints deleted and refunded amounts as they are. */
const plainAmount = (v: unknown): string => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? String(n) : "";
};

/**
 * The statuses as Workiz's log spells them ("In progress", "done pending
 * approval" — not our labels' casing).
 */
const WORKIZ_STATUS: Record<string, string> = {
  submitted: "Submitted",
  in_progress: "In progress",
  done: "Done",
  pending: "Pending",
  done_pending_approval: "done pending approval",
  canceled: "Canceled",
};

/** "Added payment 349.89 in …" (Workiz: Cash, Check, Credit charge). */
const PAYMENT_METHOD: Record<string, string> = {
  card: "Credit charge",
  cash: "Cash",
  check: "Check",
  bank: "Bank transfer",
  other: "Other",
};

/** "Deleted payment 433 …" (Workiz: cash, check, credit — only offline payments are deleted). */
const DELETED_METHOD: Record<string, string> = { card: "credit", cash: "cash", check: "check", bank: "bank", other: "other" };

/** An item edit's numbers: Workiz writes prices without a "$". */
const ITEM_CHANGE: Record<string, { label: string; money: boolean }> = {
  priceClient: { label: "Price", money: true },
  costCompany: { label: "Cost (company)", money: true },
  costForTech: { label: "Cost (tech)", money: true },
  quantity: { label: "Qty", money: false },
};

/**
 * Workiz logs a new price on a line as "Item price updated: Service Call —
 * 45.00 → 35.00" and any other edit of it as its catch-all "Update job
 * details"; what else changed (quantity, costs, the name) rides on the lines
 * under it.
 */
function itemUpdateLines(d: Record<string, unknown>): string[] {
  const name = str(d.productName);
  const prev = str(d.previousProductName);
  const changes = (d.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>;
  const price = changes.priceClient;
  const priced = Boolean(name && price && amount(price.from) && amount(price.to));
  const lines = [priced ? `Item price updated: ${name} — ${amount(price!.from)} → ${amount(price!.to)}` : "Update job details"];
  if (prev && name && prev !== name) lines.push(`Item: ${prev} → ${name}`);
  for (const [key, change] of Object.entries(changes)) {
    const meta = ITEM_CHANGE[key];
    if (!meta || (key === "priceClient" && priced)) continue;
    const fmt = (v: unknown) => (meta.money ? amount(v) || "—" : v === null || v === undefined || v === "" ? "—" : String(v));
    const what = `${meta.label}: ${fmt(change?.from)} → ${fmt(change?.to)}`;
    lines.push(name ? `${name} — ${what}` : what);
  }
  return lines;
}

/** "Status Updated - Canceled - Cant Do - tech said cant do"; no sub-status → "Status Updated - Done - ". */
function statusLine(d: Record<string, unknown>, lk: WordingLookups): string {
  const to = str(d.toStatus);
  if (!to) return "Status Updated";
  const sub = str(d.subStatusName) ?? (typeof d.subStatusId === "string" ? lk.subStatuses.get(d.subStatusId) : undefined) ?? "";
  const reason = str(d.cancellationReason);
  const parts = ["Status Updated", WORKIZ_STATUS[to] ?? humanize(to), sub || reason || ""];
  // A Canceled sub-status is the reason when none was typed — said once.
  if (sub && reason && reason !== sub) parts.push(reason);
  return parts.join(" - ");
}

function tagNames(ids: unknown, lk: WordingLookups): string[] {
  return Array.isArray(ids) ? ids.map((id) => (typeof id === "string" ? lk.tags.get(id) ?? id : String(id))) : [];
}

/**
 * Workiz's tag lines: "Added tag" (one), "Added tag(s)" (several), "Remove
 * tag from job", and "Updated tags" when some came and some went — the
 * tags named after it, ours.
 */
function tagLines(d: Record<string, unknown>, lk: WordingLookups): string[] {
  const before = new Set(Array.isArray(d.oldValue) ? (d.oldValue as unknown[]) : []);
  const after = new Set(Array.isArray(d.newValue) ? (d.newValue as unknown[]) : []);
  const added = tagNames([...after].filter((t) => !before.has(t)), lk);
  const removed = tagNames([...before].filter((t) => !after.has(t)), lk);
  const addedLine = named(added.length > 1 ? "Added tag(s)" : "Added tag", added.join(", "));
  const removedLine = named("Remove tag from job", removed.join(", "));
  if (added.length && removed.length) return ["Updated tags", named("Added tag", added.join(", ")), removedLine];
  if (added.length) return [addedLine];
  if (removed.length) return [removedLine];
  return ["Update job details"];
}

function callLines(e: TimelineEntry, extras: WordingExtras): TimelineRowText {
  const d = (e.details ?? {}) as Record<string, unknown>;
  const inbound = d.direction === "inbound";
  const number = str(inbound ? d.from : d.to);
  const who = extras.clientName || (number ? formatPhone(number) : "");
  const facts: string[] = [];
  if (typeof d.durationSeconds === "number") facts.push(formatDuration(d.durationSeconds));
  if (d.hasRecording) facts.push("recorded");
  const head =
    e.eventType === TimelineEventType.CALL_UNLINKED
      ? named("Call unlinked from job", who)
      : inbound
        ? who ? `Call from ${who}` : "Incoming call"
        : who ? `Called ${who}` : "Outgoing call";
  return { lines: facts.length ? [head, facts.join(" · ")] : [head], icon: inbound ? "call-in" : "call-out" };
}

export function entryRowText(e: TimelineEntry, lk: WordingLookups, extras: WordingExtras = {}): TimelineRowText {
  const d = (e.details ?? {}) as Record<string, unknown>;

  if (e.eventType === TimelineEventType.NOTE_ADDED) return { lines: e.note ? [e.note] : [], icon: "note" };
  if (e.eventType === TimelineEventType.CALL_LINKED || e.eventType === TimelineEventType.CALL_UNLINKED) {
    return callLines(e, extras);
  }

  // Imported: Workiz already wrote the line.
  const stamp = workizOf(e);
  if (typeof stamp?.text === "string" && stamp.text) {
    return { lines: [stamp.text], icon: stamp.native === true ? "mobile" : "web" };
  }
  if (isImportedEntry(e) && e.note) return { lines: [e.note], icon: "web" };

  const icon: RowIcon = MOBILE_EVENTS.has(e.eventType) ? "mobile" : "web";
  const one = (line: string): TimelineRowText => ({ lines: [line], icon });

  if (extras.reschedule) return one(extras.reschedule);
  const plain = PLAIN[e.eventType];
  if (plain) return one(plain);

  switch (e.eventType) {
    case TimelineEventType.STATUS_CHANGED:
      return one(statusLine(d, lk));
    case TimelineEventType.STAGE_CHANGED:
      return one(d.toStage ? `Stage Updated - ${humanize(d.toStage)}` : "Stage Updated");
    case TimelineEventType.FIELD_UPDATED: {
      if (d.field === "tagIds") return { lines: tagLines(d, lk), icon };
      // A reschedule saved as one entry: the whole visit before and after.
      if (d.field === "schedule") return one(rescheduleSentence(d.oldValue, d.newValue));
      if (d.field === "paymentStatus") return one(named("Payment status updated", humanize(d.newValue)));
      const head = d.field === "jobName" ? "Job name changed" : "Update job details";
      const more = extras.fieldDetail?.(e);
      return { lines: more ? [head, more] : [head], icon };
    }
    // The directory's name for them (Workiz's whole name), else the one written with the event.
    case TimelineEventType.TECH_ASSIGNED:
      return one(named("Tech Assigned", lk.userName(d.techId) ?? str(d.techName)));
    case TimelineEventType.TECH_UNASSIGNED:
      return one(named("Tech Unassigned", lk.userName(d.previousTechId ?? d.techId) ?? str(d.techName)));
    case TimelineEventType.SENT_TO_TECH: {
      const channels = Array.isArray(d.channels) ? (d.channels as SendToTechChannel[]) : [];
      const via = channels.map((c) => SEND_TO_TECH_CHANNEL_LABEL[c] ?? humanize(c)).join(" & ");
      const who = Array.isArray(d.techIds) ? (d.techIds as string[]).map((id) => lk.userName(id) ?? "…").join(", ") : "";
      return one(named(via ? `Sent to tech by ${via}` : "Sent to tech", who));
    }
    case TimelineEventType.ATTACHMENT_ADDED:
      return one(named("Saved Attachment", str(d.fileName)));
    case TimelineEventType.ATTACHMENT_RENAMED: {
      const name = str(d.fileName);
      const prev = str(d.previousFileName);
      return one(named("Renamed Attachment", prev && name ? `${prev} → ${name}` : name));
    }
    case TimelineEventType.ATTACHMENT_REMOVED:
      return one(named("Deleted Attachment", str(d.fileName)));
    case TimelineEventType.PRODUCT_ADDED: {
      const name = str(d.productName ?? d.name);
      const price = amount(d.priceClient);
      return one(name ? `Added item ${name}${price ? ` (${price})` : ""}` : "Added item");
    }
    case TimelineEventType.PRODUCT_UPDATED:
      return { lines: itemUpdateLines(d), icon };
    case TimelineEventType.PRODUCT_REMOVED: {
      const name = str(d.productName ?? d.name);
      const price = amount(d.priceClient);
      return one(name ? `Removed item ${name}${price ? ` (${price})` : ""}` : "Removed item");
    }
    case TimelineEventType.ESTIMATE_CREATED:
      return one(d.number ? `Created estimate #${d.number}` : "Created estimate");
    case TimelineEventType.INVOICE_CREATED:
      return one(d.number ? `Created invoice #${d.number}` : "Created invoice");
    case TimelineEventType.ESTIMATE_STATUS_CHANGED: {
      if (d.signed) return one("Client signed estimate");
      const to = d.to ?? d.status;
      if (!to) return one("Estimate status updated");
      return one(d.number ? `Updated estimate ${d.number} status to ${humanize(to)}` : `Estimate status updated - ${humanize(to)}`);
    }
    // The signature is the client's whoever held the phone — Workiz logs "Client signed invoice" either way.
    case TimelineEventType.INVOICE_SIGNED:
      return one(d.number ? `Client signed invoice #${d.number}` : "Client signed invoice");
    case TimelineEventType.PAYMENT_RECEIVED: {
      const sum = amount(d.amount);
      if (!sum) return one("Added payment");
      const method = str(d.method);
      return one(method ? `Added payment ${sum} in ${PAYMENT_METHOD[method] ?? humanize(method)}` : `Added payment ${sum}`);
    }
    case TimelineEventType.PAYMENT_REFUNDED: {
      const sum = plainAmount(d.amount);
      const method = str(d.method) ?? "";
      // A mis-keyed offline payment is deleted, not refunded — "Deleted payment 433 cash".
      if (d.deleted) return one(["Deleted payment", sum, DELETED_METHOD[method] ?? method.replace(/_/g, " ")].filter(Boolean).join(" "));
      // Only a card payment is refunded (through the processor): "Refunded payment 109.54 charge".
      return one(sum ? `Refunded payment ${sum} charge` : "Refunded payment");
    }
  }

  const doc = DOCUMENT_LABEL[e.eventType];
  if (doc) return one(d.number ? `${doc} #${d.number}` : doc);
  return one(e.note || humanize(e.eventType) || "Update job details");
}

/* ------------------------------------------------------------- schedule */

/** A visit as the job stores it: a calendar day and an "HH:MM-HH:MM" slot. */
export interface ScheduleState {
  date?: string | null;
  slot?: string | null;
  allDay?: boolean | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18:00" → "6:00 pm". */
function clock(hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

/** "Thu Oct 08 2026 6:00 pm - 7:00 pm" — Workiz's activity-log way of writing a visit. */
export function workizScheduleText(s: ScheduleState): string {
  const m = s.date ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s.date) : null;
  if (!m) return "Unscheduled";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = `${WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${MONTHS[mo - 1]} ${m[3]} ${y}`;
  if (s.allDay || !s.slot) return day;
  const [from, to] = s.slot.split("-").map((t) => clock(t));
  return from && to ? `${day} ${from} - ${to}` : day;
}

const SCHEDULE_FIELD: Record<string, keyof ScheduleState> = {
  scheduledDate: "date",
  scheduledTimeSlot: "slot",
  allDay: "allDay",
};
const SCHEDULE_FIELDS = new Set(["scheduledDate", "scheduledTimeSlot", "scheduledEndDate", "allDay"]);

/** A visit as a one-entry reschedule stores it (`{ date, endDate, slot, allDay }`). */
function visitOf(v: unknown): ScheduleState {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    date: typeof o.date === "string" ? o.date : null,
    slot: typeof o.slot === "string" ? o.slot : null,
    allDay: typeof o.allDay === "boolean" ? o.allDay : null,
  };
}

/** "Rescheduled job from Wed Oct 07 2026 5:00 pm - 6:00 pm to Thu Oct 08 2026 8:00 am - 9:00 am". */
function rescheduleSentence(from: unknown, to: unknown): string {
  return `Rescheduled job from ${workizScheduleText(visitOf(from))} to ${workizScheduleText(visitOf(to))}`;
}

const isOneEntryReschedule = (e: TimelineEntry) =>
  e.eventType === TimelineEventType.FIELD_UPDATED &&
  (e.details as { field?: unknown } | undefined)?.field === "schedule" &&
  !isImportedEntry(e);
/** Fields one save logs land within moments of each other. */
const SAME_SAVE_MS = 5000;

const isScheduleChange = (e: TimelineEntry) =>
  e.eventType === TimelineEventType.FIELD_UPDATED &&
  SCHEDULE_FIELDS.has(String((e.details as { field?: unknown } | undefined)?.field)) &&
  !isImportedEntry(e);

/**
 * BitCRM logs a reschedule as one entry per field it touched (day, slot,
 * all-day); Workiz writes one "Rescheduled job from … to …". This folds the
 * entries of one save (same person, within moments) into the newest of them
 * and words it, reading the visit back from the job as it stands now: walking
 * from the newest change to the oldest, each save's "to" is the visit then,
 * and its "from" that visit with the changed fields put back.
 *
 * Imported rows are left alone — Workiz already wrote their sentence — and
 * past one the walk no longer knows the visit, so older saves are worded
 * from their own values only. A save written as one `schedule` entry (since
 * C8) carries the whole visit before and after: it is its own sentence, and
 * the walk carries on from the visit it started from.
 */
export function collapseReschedules(
  entries: TimelineEntry[],
  /** The visit as it stands now; `null` when unknown. */
  current: ScheduleState | null,
): { hidden: Set<string>; text: Map<string, string> } {
  const hidden = new Set<string>();
  const text = new Map<string, string>();
  const newestFirst = [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  let state: ScheduleState | null = current ? { ...current } : null;

  for (let i = 0; i < newestFirst.length; i++) {
    const head = newestFirst[i];
    if (head.eventType === TimelineEventType.FIELD_UPDATED && isImportedEntry(head)) {
      if (SCHEDULE_FIELDS.has(String((head.details as { field?: unknown } | undefined)?.field))) state = null;
      continue;
    }
    if (isOneEntryReschedule(head)) {
      const d = head.details as { oldValue?: unknown; newValue?: unknown };
      text.set(head.id, rescheduleSentence(d.oldValue, d.newValue));
      state = visitOf(d.oldValue);
      continue;
    }
    if (!isScheduleChange(head)) continue;

    const group = [head];
    const t0 = Date.parse(head.timestamp);
    while (i + 1 < newestFirst.length) {
      const next = newestFirst[i + 1];
      if (!isScheduleChange(next) || next.actorId !== head.actorId || Math.abs(t0 - Date.parse(next.timestamp)) > SAME_SAVE_MS) break;
      group.push(next);
      i++;
    }

    const after: ScheduleState = state ? { ...state } : {};
    const before: ScheduleState = { ...after };
    for (const e of group) {
      const d = e.details as { field: string; oldValue?: unknown; newValue?: unknown };
      const key = SCHEDULE_FIELD[d.field];
      if (!key) continue;
      if (!state) (after as Record<string, unknown>)[key] = d.newValue ?? null;
      (before as Record<string, unknown>)[key] = d.oldValue ?? null;
    }
    text.set(head.id, `Rescheduled job from ${workizScheduleText(before)} to ${workizScheduleText(after)}`);
    for (const e of group.slice(1)) hidden.add(e.id);
    if (state) state = before;
  }
  return { hidden, text };
}
