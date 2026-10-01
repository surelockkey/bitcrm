import type { Address, EstimateStatus, InvoiceStatus, PortalDocumentSummary, PortalProposalSummary, PortalView } from "@bitcrm/types";

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

/** "Sep 30, 2026" for an ISO instant (the portal's "Sent …" lines). */
export function formatSentAt(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

/** "Tue, Oct 5 · 10:00 AM – 12:00 PM" in the job's zone. */
export function formatJobWhen(start: string | undefined, end: string | undefined, timezone: string | undefined): string {
  if (!start) return "Date to be confirmed";
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return "Date to be confirmed";
  const tz = timezone ? { timeZone: timezone } : {};
  const day = s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...tz });
  const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...tz });
  const e = end ? new Date(end) : null;
  return e && !Number.isNaN(e.getTime()) ? `${day} · ${time(s)} – ${time(e)}` : `${day} · ${time(s)}`;
}

/** An "Add to calendar" file for one job (RFC 5545), as a data URL. */
export function calendarDataUrl(job: { number: string; jobType?: string; address?: string; scheduledDate?: string; scheduledEndDate?: string }, businessName: string): string | null {
  if (!job.scheduledDate) return null;
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = job.scheduledEndDate ?? new Date(new Date(job.scheduledDate).getTime() + 60 * 60_000).toISOString();
  const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BitCRM//Client portal//EN",
    "BEGIN:VEVENT",
    `UID:job-${job.number}@bitcrm`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(job.scheduledDate)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`${job.jobType ?? "Service"} — ${businessName}`)}`,
    ...(job.address ? [`LOCATION:${esc(job.address)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}
