import {
  AGING_BUCKETS,
  DASHBOARD_TIMEZONE,
  agingBucketOf,
  agingDaysLate,
  invoiceDaysDueWindow,
  type AgingBucket,
  type AgingRow,
  type AgingSort,
  type Invoice,
  type InvoiceDaysDue,
  type InvoiceReportStatus,
  type ReportCard,
} from '@bitcrm/types';
import { addDays, businessDay, dayStartUtc, isDay } from '../../payments/report/payment-report.rules';

/**
 * Pure rules of Workiz's invoice reports — Aging invoices and the Invoices
 * page (cards, "Filter results", CSV). No I/O: the service feeds them rows.
 *
 * Every day here is a business day on the account's clock (America/New_York),
 * as Workiz counts them: "created 1–27 Sep" means New York's 1–27 Sep, and
 * Days Late is counted to New York's today.
 */

export const BILLING_REPORT_TZ = process.env.BILLING_REPORT_TIMEZONE || DASHBOARD_TIMEZONE;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Today on the business clock. */
export function reportToday(now: Date = new Date(), tz: string = BILLING_REPORT_TZ): string {
  return businessDay(now.toISOString(), tz);
}

/** A created-date window as UTC instants: `[fromIso, toIso)` — New York's days, exactly. */
export interface InstantWindow {
  fromIso?: string;
  toIso?: string;
}

export function dayWindow(from?: string, to?: string, tz: string = BILLING_REPORT_TZ): InstantWindow {
  return {
    ...(isDay(from) && { fromIso: dayStartUtc(from, tz) }),
    ...(isDay(to) && { toIso: dayStartUtc(addDays(to, 1), tz) }),
  };
}

export function inWindow(iso: string | undefined, w: InstantWindow): boolean {
  if (!iso) return !w.fromIso && !w.toIso;
  if (w.fromIso && iso < w.fromIso) return false;
  if (w.toIso && iso >= w.toIso) return false;
  return true;
}

/** Still owes money — Workiz's "unpaid" (`job_amount_due > 0`). */
export function isOpen(i: Pick<Invoice, 'status' | 'totals'>): boolean {
  return (i.status === 'due' || i.status === 'overdue') && (i.totals?.balanceDue ?? 0) > 0;
}

const balanceOf = (i: Pick<Invoice, 'totals'>): number => i.totals?.balanceDue ?? 0;

// ----------------------------------------------------------------- aging

const emptyCard = (): ReportCard => ({ count: 0, amount: 0 });

/**
 * The five Aging cards. `all` = every open invoice (overdue or not yet),
 * the four others = overdue ones by Days Late. Balances summed in cents.
 */
export function agingCards(open: Invoice[], today: string): Record<AgingBucket, ReportCard> {
  const cents = Object.fromEntries(AGING_BUCKETS.map((b) => [b, { count: 0, amount: 0 }])) as Record<
    AgingBucket,
    ReportCard
  >;
  for (const inv of open) {
    const c = Math.round(balanceOf(inv) * 100);
    cents.all.count++;
    cents.all.amount += c;
    const bucket = agingBucketOf(agingDaysLate(inv.dueDate, today));
    if (bucket) {
      cents[bucket].count++;
      cents[bucket].amount += c;
    }
  }
  const out = {} as Record<AgingBucket, ReportCard>;
  for (const b of AGING_BUCKETS) out[b] = { count: cents[b].count, amount: cents[b].amount / 100 };
  return out;
}

export function inAgingBucket(inv: Pick<Invoice, 'dueDate'>, bucket: AgingBucket, today: string): boolean {
  if (bucket === 'all') return true;
  return agingBucketOf(agingDaysLate(inv.dueDate, today)) === bucket;
}

/** An Aging row before the client is named. */
export function agingRow(inv: Invoice, today: string): AgingRow {
  return {
    invoiceId: inv.id,
    dealId: inv.dealId,
    number: inv.number,
    ...(inv.workizName && { name: inv.workizName }),
    contactId: inv.contactId,
    total: inv.totals?.total ?? 0,
    balance: balanceOf(inv),
    dueDate: inv.dueDate,
    createdAt: inv.createdAt,
    daysLate: agingDaysLate(inv.dueDate, today),
  };
}

const collator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });

/**
 * Workiz's default is the oldest debt first (Days Late, descending), then the
 * earlier-created one. Any column sorts; ties fall back to that order.
 */
export function sortAging(rows: AgingRow[], sort: AgingSort = 'daysLate', dir: 'asc' | 'desc' = 'desc'): AgingRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (r: AgingRow): string | number => {
    switch (sort) {
      case 'number':
        return r.number;
      case 'name':
        return r.name ?? '';
      case 'client':
        return r.clientName ?? '';
      case 'total':
        return r.total;
      case 'balance':
        return r.balance;
      case 'dueDate':
        return r.dueDate;
      case 'createdAt':
        return r.createdAt;
      case 'daysLate':
      default:
        return r.daysLate;
    }
  };
  const fallback = (a: AgingRow, b: AgingRow) =>
    b.daysLate - a.daysLate || a.createdAt.localeCompare(b.createdAt) || a.invoiceId.localeCompare(b.invoiceId);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb));
    return cmp !== 0 ? cmp * sign : fallback(a, b);
  });
}

// --------------------------------------------------------- invoice cards

/**
 * Workiz's Due / Overdue / Unsent cards for a created-date window: Due = every
 * open invoice created in it (overdue ones included), Overdue = those whose
 * due date is before today — counted live, not from the stored status, so a
 * sweep that has not run yet cannot hide one — Unsent = open and never sent.
 */
export function invoiceCards(
  open: Invoice[],
  window: InstantWindow,
  today: string,
): { due: ReportCard; overdue: ReportCard; unsent: { count: number } } {
  let dueN = 0;
  let dueC = 0;
  let overN = 0;
  let overC = 0;
  let unsent = 0;
  for (const inv of open) {
    if (!inWindow(inv.createdAt, window)) continue;
    const c = Math.round(balanceOf(inv) * 100);
    dueN++;
    dueC += c;
    if (inv.dueDate && inv.dueDate < today) {
      overN++;
      overC += c;
    }
    if (!inv.sentAt) unsent++;
  }
  return {
    due: { count: dueN, amount: dueC / 100 },
    overdue: { count: overN, amount: overC / 100 },
    unsent: { count: unsent },
  };
}

// ------------------------------------------------------- filter results

export interface InvoiceReportFilter extends InstantWindow {
  /** OR inside the group. */
  statuses?: InvoiceReportStatus[];
  daysDue?: InvoiceDaysDue[];
  /** `sent` / `unsent`; both (or none) = no filter. */
  sent?: Array<'sent' | 'unsent'>;
  search?: string;
}

const OPEN_ONLY: ReadonlySet<InvoiceReportStatus> = new Set(['partially_paid', 'due', 'overdue']);

/**
 * Can the filter only ever select open invoices? Then UnpaidIndex answers it
 * and the ~78 000-row list is never walked. "Days due" is about money still
 * owed, so it always narrows to open invoices.
 */
export function onlyOpen(f: InvoiceReportFilter): boolean {
  if (f.daysDue?.length) return true;
  return !!f.statuses?.length && f.statuses.every((s) => OPEN_ONLY.has(s));
}

/** Workiz's "Status" group, one option. Due = every unpaid one (overdue and part-paid included). */
export function matchesStatus(inv: Invoice, status: InvoiceReportStatus, today: string): boolean {
  switch (status) {
    case 'paid':
      return inv.status === 'paid';
    case 'partially_paid':
      return isOpen(inv) && (inv.totals?.amountPaid ?? 0) > 0;
    case 'due':
      return isOpen(inv);
    case 'overdue':
      return isOpen(inv) && !!inv.dueDate && inv.dueDate < today;
    default:
      return false;
  }
}

export function matchesDaysDue(inv: Invoice, bucket: InvoiceDaysDue, today: string): boolean {
  if (!isOpen(inv) || !inv.dueDate) return false;
  const w = invoiceDaysDueWindow(bucket, today);
  return (!w.from || inv.dueDate >= w.from) && inv.dueDate <= w.to;
}

export function normalizeSearch(raw: string | undefined): string | undefined {
  const s = raw?.trim().toLowerCase();
  return s ? s : undefined;
}

export function matchesSearch(inv: Invoice, q: string | undefined): boolean {
  if (!q) return true;
  return [inv.number, inv.workizName, inv.workizNumber === undefined ? undefined : String(inv.workizNumber)]
    .filter((v): v is string => !!v)
    .some((v) => v.toLowerCase().includes(q));
}

/** The whole filter, in memory — OR inside a group, AND between groups. */
export function matchesFilter(inv: Invoice, f: InvoiceReportFilter, today: string): boolean {
  if (!inWindow(inv.createdAt, f)) return false;
  if (f.statuses?.length && !f.statuses.some((s) => matchesStatus(inv, s, today))) return false;
  if (f.daysDue?.length && !f.daysDue.some((b) => matchesDaysDue(inv, b, today))) return false;
  const sent = new Set(f.sent ?? []);
  if (sent.size === 1) {
    if (sent.has('sent') && !inv.sentAt) return false;
    if (sent.has('unsent') && inv.sentAt) return false;
  }
  return matchesSearch(inv, normalizeSearch(f.search));
}

// ------------------------------------------------------------------- CSV

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const money = (n: number | undefined): string => (typeof n === 'number' ? n.toFixed(2) : '0.00');
export const csvRow = (cells: Array<string | number | undefined>): string =>
  cells.map((c) => csvCell(c === undefined ? '' : String(c))).join(',');

/** `2026-07-15 18:42:42` — an instant on the business clock, as Workiz writes raw dates. */
export function csvInstant(iso: string | undefined, tz: string = BILLING_REPORT_TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Workiz's Aging CSV: the table's columns, raw dates, and "Days By" for Days Late. */
export const AGING_CSV_HEADERS = [
  'Invoice No.',
  'Invoice Name',
  'Client Name',
  'Total',
  'Balance',
  'Due Date',
  'Created At',
  'Days By',
] as const;

export function agingCsvLine(r: AgingRow, tz: string = BILLING_REPORT_TZ): string {
  return csvRow([
    r.number,
    r.name ?? '',
    r.clientName ?? '',
    money(r.total),
    money(r.balance),
    r.dueDate ? `${r.dueDate} 00:00:00` : '',
    csvInstant(r.createdAt, tz),
    r.daysLate,
  ]);
}

/** Workiz's Invoices CSV — Email added, Tax after Discount, no checkbox. */
export const INVOICE_CSV_HEADERS = [
  'Invoice NO.',
  'Invoice Name',
  'Client',
  'Email Address',
  'Created',
  'Subtotal',
  'Discount',
  'Tax',
  'Total Amount',
  'Amount Due',
  'Status',
  'Job',
  'Job name',
] as const;

const STATUS_WORD: Record<string, string> = {
  paid: 'Paid',
  due: 'Due',
  overdue: 'Overdue',
  no_amount: 'No amount',
};

/** "Thu Sep 24, 2026" on the business clock — how Workiz writes "sent on …". */
export function workizDate(iso: string, tz: string = BILLING_REPORT_TZ): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const wd = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
  const md = d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: '2-digit', year: 'numeric' });
  return `${wd} ${md}`;
}

/** The Status cell: the word, then "sent on …" or "Not sent", as the table stacks them. */
export function invoiceStatusText(inv: Pick<Invoice, 'status' | 'sentAt'>, tz: string = BILLING_REPORT_TZ): string {
  const word = STATUS_WORD[inv.status] ?? inv.status;
  return inv.sentAt ? `${word} - sent on ${workizDate(inv.sentAt, tz)}` : `${word} - Not sent`;
}

export function invoiceCsvLine(
  inv: Invoice,
  client: { name?: string; email?: string } | undefined,
  tz: string = BILLING_REPORT_TZ,
): string {
  const t = inv.totals;
  return csvRow([
    inv.number,
    inv.workizName ?? '',
    client?.name ?? '',
    client?.email ?? '',
    inv.createdAt ? businessDay(inv.createdAt, tz) : '',
    money(t?.subtotal),
    // Workiz leaves the Discount column of its CSV empty.
    '',
    money(t?.tax),
    money(t?.total),
    money(t?.balanceDue),
    invoiceStatusText(inv, tz),
    inv.number,
    '',
  ]);
}

export { round2 };
