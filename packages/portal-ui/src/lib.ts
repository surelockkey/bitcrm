import type { Address, EstimateStatus, InvoiceStatus, PortalDocumentSummary, PortalView } from "@bitcrm/types";

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
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  red: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  zinc: "border-zinc-500/30 bg-zinc-500/5 text-zinc-500 dark:text-zinc-400",
};

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
