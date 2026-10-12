import { DEFAULT_TIMEZONE, PORTAL_INBOX_SHOW, portalInboxCompare, wallClockInstant, zoneAbbr } from "@bitcrm/types";
import type {
  Address,
  EstimateStatus,
  InvoiceStatus,
  PortalDocumentSummary,
  PortalInboxPage,
  PortalInboxShow,
  PortalJob,
  PortalProposalSummary,
  PortalView,
} from "@bitcrm/types";

/** Class names that are truthy, joined. (No Tailwind-merge: nothing here needs to override.) */
export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ errors */

/** Error from the unauthenticated portal client (never touches a staff session). */
export class PublicApiError extends Error {
  readonly status: number;
  /** Set when the API names the business behind a dead link. */
  readonly businessName?: string;

  constructor(status: number, message: string, businessName?: string) {
    super(message);
    this.name = "PublicApiError";
    this.status = status;
    this.businessName = businessName;
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; message: string | undefined; businessName?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** `{ success, data }` → data; `{ success:false, error }` → its message. */
export function unwrapEnvelope<T>(body: unknown): Envelope<T> {
  if (isRecord(body) && body.success === true) return { ok: true, data: body.data as T };
  let message: string | undefined;
  let businessName: string | undefined;
  if (isRecord(body)) {
    const { error } = body;
    if (typeof body.message === "string") message = body.message;
    else if (typeof error === "string") message = error;
    else if (isRecord(error) && typeof error.message === "string") message = error.message;
    for (const src of [body, isRecord(error) ? error : null, isRecord(body.data) ? body.data : null]) {
      if (src && typeof src.businessName === "string") businessName = src.businessName;
    }
  }
  return businessName ? { ok: false, message, businessName } : { ok: false, message };
}

/** The token is unknown, revoked or expired (as opposed to a transient failure). */
export function isInvalidPortalError(e: unknown): boolean {
  return e instanceof PublicApiError && [400, 401, 403, 404, 410].includes(e.status);
}

/* ---------------------------------------------------------------- formatting */

export function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "Sep 1, 2026" for a `YYYY-MM-DD` day (read as local — never through UTC, or a
 * date shows up as the day before) or an ISO instant; "—" for anything else.
 */
export function formatYmd(value: string | undefined | null): string {
  if (!value) return "—";
  const m = YMD.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function documentKindLabel(kind: PortalDocumentSummary["kind"]): string {
  return kind === "invoice" ? "Invoice" : "Estimate";
}

export function documentTitle(doc: Pick<PortalDocumentSummary, "kind" | "number">): string {
  return `${documentKindLabel(doc.kind)} #${doc.number}`;
}

export function firstNameOf(client: PortalView["client"]): string {
  return client.firstName?.trim() || "";
}

export function businessInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "•"
  );
}

export function businessAddressLine(a: Address | undefined): string {
  if (!a) return "";
  const stateZip = [a.state, a.zip].filter(Boolean).join(" ");
  return [a.street, a.unit, a.city, stateZip].filter(Boolean).join(", ");
}

export function telHref(phone: string): string {
  const plus = phone.trim().startsWith("+");
  return `tel:${plus ? "+" : ""}${phone.replace(/\D/g, "")}`;
}

export function websiteHref(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

/** An invoice the client still owes money on. */
export function isOwing(doc: PortalDocumentSummary): boolean {
  return doc.kind === "invoice" && typeof doc.balanceDue === "number" && doc.balanceDue > 0 && doc.status !== "paid";
}

/** What the client owes across all shown invoices, and how many of them are open. */
export function outstanding(invoices: PortalDocumentSummary[]): { total: number; count: number; overdue: boolean } {
  const open = invoices.filter(isOwing);
  return {
    total: open.reduce((sum, d) => sum + (d.balanceDue ?? 0), 0),
    count: open.length,
    overdue: open.some((d) => d.status === "overdue"),
  };
}

/* ------------------------------------------------------------------ statuses */

type Tone = "slate" | "amber" | "red" | "emerald" | "sky" | "zinc";

const TONE: Record<Tone, string> = {
  slate: "border-[#3b4b52]/25 bg-[#f3f4f5] text-[#3b4b52]",
  amber: "border-[#f5ba45]/50 bg-[#fdf3dc] text-[#8a5a00]",
  red: "border-[#e05c5c]/40 bg-[#fdecec] text-[#a02525]",
  emerald: "border-[#50d58c]/50 bg-[#eefbf4] text-[#1f7a4a]",
  sky: "border-[#6aa8ee]/50 bg-[#eef5fd] text-[#1b5fae]",
  zinc: "border-[#e9ebec] bg-white text-[#637075]",
};

/**
 * Tone fragments for the places a whole pill is not what is wanted — a lone
 * warning line, a card ring, a badge fill. They live here for the same reason
 * `TONE` does: a component that writes its own palette string becomes the
 * fifth copy nobody updates.
 */
export const TONE_TEXT = {
  warning: "text-[#b7791f]",
  good: "text-[#2f9e63]",
} as const;

export const TONE_PANEL = {
  good: "border-[#50d58c]/40 bg-[#eefbf4]",
  bad: "border-[#e05c5c]/40 bg-[#fdecec]",
  neutral: "border-[#e9ebec] bg-white",
} as const;

export const TONE_BADGE = {
  good: "bg-[#50d58c]/15 text-[#2f9e63]",
  bad: "bg-[#e05c5c]/10 text-[#e05c5c]",
  neutral: "bg-[#f3f4f5] text-[#637075]",
} as const;

const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  no_amount: { label: "No amount", tone: "slate" },
  due: { label: "Due", tone: "amber" },
  overdue: { label: "Overdue", tone: "red" },
  paid: { label: "Paid", tone: "emerald" },
};

const ESTIMATE_STATUS: Record<EstimateStatus, { label: string; tone: Tone }> = {
  unsent: { label: "Unsent", tone: "slate" },
  pending: { label: "Pending", tone: "amber" },
  approved: { label: "Approved", tone: "sky" },
  declined: { label: "Declined", tone: "red" },
  won: { label: "Won", tone: "emerald" },
  archived: { label: "Archived", tone: "zinc" },
};

export function statusMeta(doc: Pick<PortalDocumentSummary, "kind" | "status">): { label: string; className: string } {
  const table = (doc.kind === "invoice" ? INVOICE_STATUS : ESTIMATE_STATUS) as Record<string, { label: string; tone: Tone }>;
  const meta = table[doc.status] ?? { label: String(doc.status), tone: "slate" as Tone };
  return { label: meta.label, className: TONE[meta.tone] };
}

/* ------------------------------------------------------------ Workiz inbox */

/**
 * "Sep 30, 2026" for an ISO instant (the portal's "Sent …" and payment
 * lines) — the day on the job's clock (`timezone`, else New York), never the
 * phone's (owner, 2026-10-12). A day, so no zone label.
 */
export function formatSentAt(iso: string | undefined, timezone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: jobClock(timezone) });
}

/**
 * The status chip of a Workiz inbox card: AWAITING APPROVAL on an open
 * estimate, PENDING / OVERDUE / PAID on an invoice, APPROVED / DECLINED once
 * decided. Upper-case by convention, like Workiz.
 */
export function inboxChip(doc: Pick<PortalDocumentSummary, "kind" | "status" | "balanceDue">): { label: string; className: string } {
  if (doc.kind === "estimate") {
    const s = doc.status as EstimateStatus;
    if (s === "pending" || s === "unsent") return { label: "AWAITING APPROVAL", className: TONE.amber };
    if (s === "approved" || s === "won") return { label: "APPROVED", className: TONE.emerald };
    if (s === "declined") return { label: "DECLINED", className: TONE.red };
    return { label: "ARCHIVED", className: TONE.zinc };
  }
  const s = doc.status as InvoiceStatus;
  if (s === "paid" || (typeof doc.balanceDue === "number" && doc.balanceDue <= 0 && s !== "no_amount")) {
    return { label: "PAID", className: TONE.emerald };
  }
  if (s === "overdue") return { label: "OVERDUE", className: TONE.red };
  if (s === "no_amount") return { label: "NO AMOUNT", className: TONE.slate };
  return { label: "PENDING", className: TONE.amber };
}

export function proposalChip(p: Pick<PortalProposalSummary, "status">): { label: string; className: string } {
  if (p.status === "approved") return { label: "APPROVED", className: TONE.emerald };
  if (p.status === "declined") return { label: "DECLINED", className: TONE.red };
  if (p.status === "archived") return { label: "ARCHIVED", className: TONE.zinc };
  return { label: "PENDING", className: TONE.amber };
}

/** An estimate the client can still decide on. */
export function isOpenEstimate(doc: PortalDocumentSummary): boolean {
  return doc.kind === "estimate" && (doc.status === "pending" || doc.status === "unsent") && doc.sent;
}

/** The deposit still owed on an estimate (after what already settled). */
export function depositOwed(doc: Pick<PortalDocumentSummary, "depositDue" | "depositPaid">): number {
  const due = doc.depositDue ?? 0;
  const paid = doc.depositPaid ?? 0;
  return Math.max(0, Math.round((due - paid) * 100) / 100);
}

export function clientInitials(client: PortalView["client"]): string {
  const i = `${client.firstName?.trim()?.[0] ?? ""}${client.lastName?.trim()?.[0] ?? ""}`.toUpperCase();
  return i || "•";
}

/* ------------------------------------------------------- the job's clock */

/**
 * A job keeps its visit as a wall-clock day (`YYYY-MM-DD`) and slot
 * (`HH:MM-HH:MM`) on its own clock, and the server sends that clock's zone.
 * Owner, 2026-10-12: outside the office app a time is told on the JOB's clock
 * — New York when the zone is unknown — and a clock time says which zone it is
 * in ("10:00 AM CDT"); a day is printed as stored, never shifted through the
 * phone's zone.
 */
export type VisitClock = Pick<PortalJob, "scheduledDate" | "scheduledEndDate" | "scheduledTimeSlot" | "allDay" | "timezone">;

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** The zone to read a job in: its own when readable, else New York. */
function jobClock(timezone: string | undefined): string {
  if (!timezone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** The stored day (an older row may hold an instant: its first ten characters). */
function storedDay(value: string | undefined): string | null {
  const day = value?.slice(0, 10);
  return day && YMD.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? day : null;
}

/** The slot's two ends as readable "HH:MM", or nothing. */
function slotEnds(slot: string | undefined): { start: string; end?: string } | null {
  const [from, to] = (slot ?? "").split("-").map((t) => t.trim());
  if (!from || !HHMM.test(from)) return null;
  return { start: from, ...(to && HHMM.test(to) && { end: to }) };
}

const clockText = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * "10:00 AM – 12:00 PM CDT": the visit window as stored, with its zone named
 * once after the end — or after each end when the clock changes between them
 * ("9:00 AM CDT – 5:00 PM CST"). `null` for an all-day visit or no readable time.
 */
export function formatVisitTimes(visit: VisitClock): string | null {
  const day = storedDay(visit.scheduledDate);
  const slot = slotEnds(visit.scheduledTimeSlot);
  if (visit.allDay || !day || !slot) return null;
  const tz = jobClock(visit.timezone);
  const endDay = storedDay(visit.scheduledEndDate) ?? day;
  const startAbbr = zoneAbbr(wallClockInstant(day, slot.start, tz), tz);
  const label = (text: string, abbr: string) => (abbr ? `${text} ${abbr}` : text);
  if (!slot.end || (slot.end === slot.start && endDay === day)) return label(clockText(slot.start), startAbbr);
  const endAbbr = zoneAbbr(wallClockInstant(endDay, slot.end, tz), tz);
  return startAbbr === endAbbr
    ? `${clockText(slot.start)} – ${label(clockText(slot.end), endAbbr)}`
    : `${label(clockText(slot.start), startAbbr)} – ${label(clockText(slot.end), endAbbr)}`;
}

/** "Mon, Oct 12" of a stored day — read as a calendar date, never shifted. */
const shortDay = (ymd: string) =>
  new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "Tue, Jul 14 · 10:00 AM – 12:00 PM CDT" — My Booking's when; the date alone for an all-day visit. */
export function formatJobWhen(job: VisitClock): string {
  const day = storedDay(job.scheduledDate);
  if (!day) return "Date to be confirmed";
  const endDay = storedDay(job.scheduledEndDate);
  const days = endDay && endDay !== day ? `${shortDay(day)} – ${shortDay(endDay)}` : shortDay(day);
  const times = formatVisitTimes(job);
  return times ? `${days} · ${times}` : days;
}

/** `YYYYMMDD` of a stored day plus `n` days (an all-day event's end is exclusive). */
const icsDay = (ymd: string, n = 0) => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

/**
 * An "Add to calendar" file for one job (RFC 5545), as a data URL. A timed
 * visit is two UTC instants read on the job's clock (an hour when the slot
 * has no end); an all-day visit, or one with no time, is a date event.
 */
export function calendarDataUrl(
  job: { number: string; jobType?: string; address?: string } & VisitClock,
  businessName: string,
): string | null {
  const day = storedDay(job.scheduledDate);
  if (!day) return null;
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const endDay = storedDay(job.scheduledEndDate) ?? day;
  const slot = job.allDay ? null : slotEnds(job.scheduledTimeSlot);
  let when: string[];
  if (slot) {
    const tz = jobClock(job.timezone);
    const start = wallClockInstant(day, slot.start, tz);
    const end = slot.end ? wallClockInstant(endDay, slot.end, tz) : new Date(start.getTime() + 60 * 60_000);
    when = [`DTSTART:${stamp(start)}`, `DTEND:${stamp(end > start ? end : new Date(start.getTime() + 60 * 60_000))}`];
  } else {
    when = [`DTSTART;VALUE=DATE:${icsDay(day)}`, `DTEND;VALUE=DATE:${icsDay(endDay > day ? endDay : day, 1)}`];
  }
  const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BitCRM//Client portal//EN",
    "BEGIN:VEVENT",
    `UID:job-${job.number}@bitcrm`,
    `DTSTAMP:${stamp(new Date())}`,
    ...when,
    `SUMMARY:${esc(`${job.jobType ?? "Service"} — ${businessName}`)}`,
    ...(job.address ? [`LOCATION:${esc(job.address)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}

/* ------------------------------------------------------------ paged inbox */

/** One line of the inbox: a document, or a proposal standing for its options. */
export type InboxEntry =
  | { kind: "doc"; doc: PortalDocumentSummary }
  | { kind: "proposal"; proposal: PortalProposalSummary };

type InboxLists = Pick<PortalInboxPage, "invoices" | "estimates" | "proposals">;

/**
 * The inbox in the server's own order (`portalInboxCompare`: date, then
 * kind:id), so a page appended under "Load more" lands exactly where the
 * server put it. An estimate that is an option of a listed proposal is not a
 * line of its own.
 */
export function inboxEntries(lists: InboxLists): InboxEntry[] {
  const inProposal = new Set(lists.proposals.flatMap((p) => p.estimateIds));
  const keyed: Array<{ at: string; ref: string; entry: InboxEntry }> = [
    ...lists.invoices.map((doc) => ({ at: doc.date ?? "", ref: `invoice:${doc.id}`, entry: { kind: "doc" as const, doc } })),
    ...lists.estimates
      .filter((e) => !inProposal.has(e.id))
      .map((doc) => ({ at: doc.date ?? "", ref: `estimate:${doc.id}`, entry: { kind: "doc" as const, doc } })),
    ...lists.proposals.map((proposal) => ({
      at: proposal.sentAt ?? "",
      ref: `proposal:${proposal.id}`,
      entry: { kind: "proposal" as const, proposal },
    })),
  ];
  return keyed.sort(portalInboxCompare).map((k) => k.entry);
}

/** How many inbox lines these lists make. */
export const inboxCount = (lists: InboxLists): number => inboxEntries(lists).length;

/** The view's first page as an inbox page (an older API sends everything and no `inbox`). */
export function inboxOf(view: Pick<PortalView, "invoices" | "estimates" | "proposals" | "inbox">): PortalInboxPage {
  const lists = { invoices: view.invoices ?? [], estimates: view.estimates ?? [], proposals: view.proposals ?? [] };
  return { ...lists, inbox: view.inbox ?? { total: inboxCount(lists) } };
}

/** "Load more": the next page after what is loaded, nothing twice; its cursor and total win. */
export function mergeInboxPage(current: PortalInboxPage, next: PortalInboxPage): PortalInboxPage {
  const add = <T extends { id: string }>(have: T[], more: T[]) => {
    const seen = new Set(have.map((x) => x.id));
    return [...have, ...more.filter((x) => !seen.has(x.id))];
  };
  return {
    invoices: add(current.invoices, next.invoices),
    estimates: add(current.estimates, next.estimates),
    proposals: add(current.proposals, next.proposals),
    inbox: next.inbox,
  };
}

/** Workiz's "Inbox Display" boxes, in their order. */
export const INBOX_SHOW_OPTIONS: ReadonlyArray<{ value: PortalInboxShow; label: string }> = [
  { value: "invoices", label: "Invoices" },
  { value: "estimates", label: "Estimates" },
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
];

export const isWholeInbox = (show: readonly PortalInboxShow[]): boolean => PORTAL_INBOX_SHOW.every((s) => show.includes(s));

/** "N Selected" as Workiz counts it: the four boxes, and Display All too once all four are on. */
export const inboxSelectedCount = (show: readonly PortalInboxShow[]): number => show.length + (isWholeInbox(show) ? 1 : 0);

/** `?cursor=&limit=&show=` for an inbox page: the defaults (ten, everything) are left out. */
export function inboxQueryString(q: { cursor?: string; limit?: number; show?: readonly PortalInboxShow[] }): string {
  const params = new URLSearchParams();
  if (q.cursor) params.set("cursor", q.cursor);
  if (q.limit && q.limit !== 10) params.set("limit", String(q.limit));
  if (q.show && !isWholeInbox(q.show)) params.set("show", q.show.join(","));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
