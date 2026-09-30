import {
  PAYMENT_REPORT_ELECTRONIC_TYPES,
  PAYMENT_REPORT_TYPE_FILTERS,
  paymentReportTypeLabel,
  type Payment,
  type PaymentRefund,
  type PaymentReportStatus,
  type PaymentReportTotals,
} from '@bitcrm/types';

/**
 * The Payments report (Workiz Reports → Payments) as pure functions: which
 * lines a payment produces, what each line adds to the totals, which bucket
 * it is counted in, and the business-day arithmetic. No I/O — the projector,
 * the rebuild script and the tests all share these.
 */

/**
 * The business runs on Eastern time (Workiz's account zone, and the web
 * app's `DEFAULT_TZ`). A report DAY is a day on this clock; the aggregates
 * are bucketed by it, so changing it means running `rebuild:payment-report`.
 */
export const PAYMENT_REPORT_TZ = process.env.PAYMENT_REPORT_TIMEZONE || 'America/New_York';

/** Placeholder in a bucket key for "no technician" / "no service area". */
export const NONE = '-';

// ------------------------------------------------------------------- lines

/** One line of the report as it is STORED (`PAYLINE#<month>` rows). Names are joined on read. */
export interface ReportLine {
  lineId: string;
  kind: 'payment' | 'refund' | 'reversal';
  paymentId: string;
  refundId?: string;
  invoiceId: string;
  dealId: string;
  contactId: string;
  /** ISO UTC — the payment date (refund date, reversal date). */
  at: string;
  /** Business day of `at`, YYYY-MM-DD. */
  day: string;
  type: string;
  /** Signed dollars, tip included; 0 on a failed payment. */
  amount: number;
  tip: number;
  /** Processor fee (Workiz Pay `app_fee`), dollars. */
  fee: number;
  /** What was paid out (`amount − fee`), dollars. */
  net: number;
  status?: PaymentReportStatus;
  reference?: string;
  description?: string;
  last4?: string;
  technicianId?: string;
  serviceAreaId?: string;
  transactionMethod?: string;
  collectedById?: string;
  collectedByName?: string;
  dealNumber?: string;
}

/** Dimensions a line is filtered by that the payment row may not carry itself. */
export interface LineDims {
  technicianId?: string;
  serviceAreaId?: string;
  dealNumber?: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const toCents = (dollars: number): number => Math.round((dollars || 0) * 100);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isStripeBacked = (p: Pick<Payment, 'stripePaymentIntentId' | 'stripeSessionId' | 'stripeChargeId'>) =>
  !!(p.stripePaymentIntentId || p.stripeSessionId || p.stripeChargeId);

/**
 * A portal checkout the client never confirmed — still open, superseded or
 * expired. It is a row in the ledger (so a second attempt cannot double-pay)
 * but no money moved, so Workiz would not list it and neither do we.
 * Imported rows are never sessions of ours (`externalId`).
 */
export function isUnconfirmedCheckout(p: Payment): boolean {
  // Money that was collected (or collected and given back) was confirmed.
  if (p.status === 'settled' || p.status === 'refunded' || p.status === 'reversed') return false;
  if (p.stripePaymentIntentId || p.stripeChargeId || p.externalId) return false;
  return !!p.stripeSessionId || (p.source === 'portal' && p.takenBy === 'client');
}

/**
 * The Workiz type of a payment. Imported rows carry it (`methodDetail`); a
 * payment taken here maps from its method: a card through Stripe is a
 * "Credit charge", a card keyed in by staff "Credit offline", ACH "Bank
 * transfer (ACH)".
 */
export function paymentReportType(p: Payment): string {
  if (p.methodDetail) return p.methodDetail;
  switch (p.method) {
    case 'card':
      return isStripeBacked(p) ? 'charge' : 'credit';
    case 'bank':
      return 'bank_transfer';
    case 'cash':
      return 'cash';
    case 'check':
      return 'check';
    default:
      return 'other';
  }
}

/** A refund line's type: Workiz's own, else a refund through Stripe vs one given back by hand. */
export function refundReportType(r: PaymentRefund, p: Payment): string {
  if (r.methodDetail) return r.methodDetail;
  return r.stripeRefundId || isStripeBacked(p) ? 'refund' : 'refund_offline';
}

/** The Status tag — only electronic types have one (Workiz leaves offline cells empty). */
function tagFor(type: string, status: PaymentReportStatus): PaymentReportStatus | undefined {
  return PAYMENT_REPORT_ELECTRONIC_TYPES.includes(type) ? status : undefined;
}

function paymentDescription(p: Payment): string | undefined {
  if (p.status === 'failed' || p.status === 'reversed') return p.failureReason ?? p.note;
  const refunded = p.refundedAmount ?? 0;
  if (p.status === 'refunded' || (refunded > 0 && refunded >= p.amount)) return 'Refunded';
  if (refunded > 0) return 'Partially refunded';
  return p.note;
}

function collector(p: Payment): { collectedById?: string; collectedByName?: string } {
  const id = p.collectedBy ?? (UUID.test(p.takenBy ?? '') ? p.takenBy : undefined);
  return {
    ...(id && { collectedById: id }),
    ...(p.collectedByName && { collectedByName: p.collectedByName }),
  };
}

/**
 * Every line one payment puts in the report, as Workiz lists them:
 *
 * - the payment itself on its payment date, at its FULL amount (tip
 *   included) — even once refunded, because Workiz keeps the original and
 *   lists the refund separately; a failed payment shows 0;
 * - each refund that went through (or is going through) as a NEGATIVE line
 *   on the refund's date — Workiz's amount when imported, else ours;
 * - a reversal (ACH return, lost dispute) as a negative "Dispute" line on the
 *   reversal date, the way Workiz lists a dispute.
 *
 * An unconfirmed portal checkout produces nothing.
 */
export function reportLines(
  p: Payment,
  refunds: PaymentRefund[],
  dims: LineDims = {},
  tz: string = PAYMENT_REPORT_TZ,
): ReportLine[] {
  if (isUnconfirmedCheckout(p)) return [];
  const type = paymentReportType(p);
  const technicianId = p.technicianId ?? dims.technicianId;
  const serviceAreaId = p.serviceAreaId ?? dims.serviceAreaId;
  const shared = {
    paymentId: p.id,
    invoiceId: p.invoiceId,
    dealId: p.dealId,
    contactId: p.contactId,
    ...(technicianId && { technicianId }),
    ...(serviceAreaId && { serviceAreaId }),
    ...(dims.dealNumber && { dealNumber: dims.dealNumber }),
  };

  const failed = p.status === 'failed';
  const tip = failed ? 0 : round2(p.tipAmount ?? 0);
  const amount = failed ? 0 : round2(p.amount + (p.tipAmount ?? 0));
  const fee = failed ? 0 : round2(p.processingFee ?? 0);
  const status: PaymentReportStatus =
    p.status === 'pending' ? 'pending' : failed ? 'failed' : p.status === 'reversed' ? 'reversed' : 'succeeded';
  const description = paymentDescription(p);
  const tag = tagFor(type, status);

  const lines: ReportLine[] = [
    {
      lineId: p.id,
      kind: 'payment',
      ...shared,
      at: p.takenAt,
      day: businessDay(p.takenAt, tz),
      type,
      amount,
      tip,
      fee,
      net: failed ? 0 : p.netAmount !== undefined ? round2(p.netAmount) : round2(amount - fee),
      ...(tag && { status: tag }),
      ...(p.reference && { reference: p.reference }),
      ...(description && { description }),
      ...(type === 'charge' && p.last4 && { last4: p.last4 }),
      ...(p.transactionMethod && { transactionMethod: p.transactionMethod }),
      ...collector(p),
    },
  ];

  for (const r of refunds) {
    if (r.status === 'failed' || r.status === 'canceled') continue;
    const rType = refundReportType(r, p);
    const rAmount = round2(typeof r.workizAmount === 'number' ? -Math.abs(r.workizAmount) : -Math.abs(r.amount));
    const rTag = tagFor(rType, r.status === 'pending' ? 'pending' : 'succeeded');
    const rDescription = r.reason ?? r.note ?? r.failureReason;
    const byId = r.refundedBy && UUID.test(r.refundedBy) ? r.refundedBy : undefined;
    lines.push({
      lineId: r.id,
      kind: 'refund',
      refundId: r.id,
      ...shared,
      at: r.createdAt,
      day: businessDay(r.createdAt, tz),
      type: rType,
      amount: rAmount,
      tip: 0,
      fee: 0,
      net: rAmount,
      ...(rTag && { status: rTag }),
      ...(r.reference && { reference: r.reference }),
      ...(rDescription && { description: rDescription }),
      ...(r.transactionMethod && { transactionMethod: r.transactionMethod }),
      ...(byId && { collectedById: byId }),
      ...(r.collectedByName && { collectedByName: r.collectedByName }),
    });
  }

  if (p.status === 'reversed' && p.reversedAt) {
    // What left again: the gross less anything already refunded.
    const back = round2(Math.max(0, p.amount + (p.tipAmount ?? 0) - (p.refundedAmount ?? 0)));
    lines.push({
      lineId: `${p.id}:reversal`,
      kind: 'reversal',
      ...shared,
      at: p.reversedAt,
      day: businessDay(p.reversedAt, tz),
      type: 'dispute',
      amount: -back,
      tip: 0,
      fee: 0,
      net: -back,
      ...(p.failureReason && { description: p.failureReason }),
    });
  }
  return lines;
}

// ----------------------------------------------------------------- buckets

/** What one line adds to its bucket — integers, so the running sums are exact. */
export interface Contribution {
  n: number;
  amountCents: number;
  tipsCents: number;
  feesCents: number;
}

/** `<type>#<technicianId|->#<serviceAreaId|->` — the filter dimensions of a line. */
export const bucketOf = (l: Pick<ReportLine, 'type' | 'technicianId' | 'serviceAreaId'>): string =>
  `${l.type}#${l.technicianId || NONE}#${l.serviceAreaId || NONE}`;

export function parseBucket(bucket: string): { type: string; technicianId?: string; serviceAreaId?: string } {
  const [type, tech, area] = bucket.split('#');
  return {
    type,
    ...(tech && tech !== NONE && { technicianId: tech }),
    ...(area && area !== NONE && { serviceAreaId: area }),
  };
}

export const contributionOf = (l: ReportLine): Contribution => ({
  n: 1,
  amountCents: toCents(l.amount),
  tipsCents: toCents(l.tip),
  feesCents: toCents(l.fee),
});

/** `<day>#<bucket>` → summed contribution. The unit of every aggregate delta. */
export type DayBuckets = Map<string, Contribution>;

export function addInto(target: DayBuckets, key: string, c: Contribution, sign: 1 | -1 = 1): void {
  const cur = target.get(key) ?? { n: 0, amountCents: 0, tipsCents: 0, feesCents: 0 };
  target.set(key, {
    n: cur.n + sign * c.n,
    amountCents: cur.amountCents + sign * c.amountCents,
    tipsCents: cur.tipsCents + sign * c.tipsCents,
    feesCents: cur.feesCents + sign * c.feesCents,
  });
}

export const isZero = (c: Contribution): boolean =>
  c.n === 0 && c.amountCents === 0 && c.tipsCents === 0 && c.feesCents === 0;

/**
 * `new − old`, per `<day>#<bucket>`, without the zero entries. A payment
 * whose lines did not move produces nothing to write.
 */
export function bucketDelta(
  oldEntries: Array<{ key: string; c: Contribution }>,
  newEntries: Array<{ key: string; c: Contribution }>,
): DayBuckets {
  const out: DayBuckets = new Map();
  for (const e of oldEntries) addInto(out, e.key, e.c, -1);
  for (const e of newEntries) addInto(out, e.key, e.c, 1);
  for (const [k, c] of out) if (isZero(c)) out.delete(k);
  return out;
}

// ----------------------------------------------------------------- filters

export interface ReportFilter {
  /** Expanded Workiz types (Refund → refund + refund_offline). Empty = all. */
  types: string[];
  technicianIds: string[];
  serviceAreaIds: string[];
}

/** Filter-group values → the concrete types they select (`refund` means both refund kinds). */
export function expandTypes(values: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const v of values ?? []) {
    const known = PAYMENT_REPORT_TYPE_FILTERS.find((f) => f.value === v);
    for (const t of known ? known.types : [v]) out.add(t);
  }
  return [...out];
}

export function matchesBucket(bucket: string, f: ReportFilter): boolean {
  const b = parseBucket(bucket);
  if (f.types.length && !f.types.includes(b.type)) return false;
  if (f.technicianIds.length && !(b.technicianId && f.technicianIds.includes(b.technicianId))) return false;
  if (f.serviceAreaIds.length && !(b.serviceAreaId && f.serviceAreaIds.includes(b.serviceAreaId))) return false;
  return true;
}

/** What a search box value means: an amount, or text (job #, confirmation, last 4). */
export function parseSearch(raw: string | undefined): { text?: string; amount?: number } | null {
  const q = (raw ?? '').trim();
  if (!q) return null;
  const money = q.replace(/[$,\s]/g, '');
  if (/^-?\d+(\.\d{1,2})?$/.test(money)) {
    return { text: q.toUpperCase(), amount: Math.abs(Number(money)) };
  }
  return { text: q.toUpperCase() };
}

export function matchesSearch(l: ReportLine, s: { text?: string; amount?: number } | null): boolean {
  if (!s) return true;
  if (s.amount !== undefined && Math.abs(l.amount) === s.amount) return true;
  if (!s.text) return false;
  if (l.dealNumber && l.dealNumber.toUpperCase() === s.text) return true;
  if (l.reference && l.reference.toUpperCase().includes(s.text)) return true;
  if (l.last4 && l.last4 === s.text) return true;
  return false;
}

// ------------------------------------------------------------------ totals

export interface BucketRow {
  bucket: string;
  n: number;
  amountCents: number;
  tipsCents: number;
  feesCents: number;
  /** YYYY-MM-DD for a day row, YYYY-MM for a month row. */
  period: string;
}

export function emptyTotals(): PaymentReportTotals {
  return { count: 0, amount: 0, tips: 0, serviceFees: 0, byType: {} };
}

/** Sums bucket rows that pass the filter into the two cards (+ per type). */
export function totalsFrom(rows: BucketRow[], f: ReportFilter): PaymentReportTotals {
  let n = 0;
  let a = 0;
  let t = 0;
  let fee = 0;
  const byType = new Map<string, { n: number; a: number; t: number }>();
  for (const r of rows) {
    if (!matchesBucket(r.bucket, f)) continue;
    n += r.n;
    a += r.amountCents;
    t += r.tipsCents;
    fee += r.feesCents;
    const type = parseBucket(r.bucket).type;
    const cur = byType.get(type) ?? { n: 0, a: 0, t: 0 };
    byType.set(type, { n: cur.n + r.n, a: cur.a + r.amountCents, t: cur.t + r.tipsCents });
  }
  const out: PaymentReportTotals = { count: n, amount: a / 100, tips: t / 100, serviceFees: fee / 100, byType: {} };
  for (const [type, v] of [...byType.entries()].sort()) {
    if (v.n === 0 && v.a === 0 && v.t === 0) continue;
    out.byType[type] = { count: v.n, amount: v.a / 100, tips: v.t / 100 };
  }
  return out;
}

/** Totals straight from lines — the search path, where buckets cannot answer. */
export function totalsFromLines(lines: ReportLine[]): PaymentReportTotals {
  return totalsFrom(
    lines.map((l) => ({ bucket: bucketOf(l), period: l.day, ...contributionOf(l) })),
    { types: [], technicianIds: [], serviceAreaIds: [] },
  );
}

/** Lines per month (the list walk skips months with none). */
export function monthCounts(rows: BucketRow[], f: ReportFilter): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!matchesBucket(r.bucket, f) || r.n === 0) continue;
    const m = r.period.slice(0, 7);
    out.set(m, (out.get(m) ?? 0) + r.n);
  }
  for (const [m, n] of out) if (n <= 0) out.delete(m);
  return out;
}

// ------------------------------------------------------------- time & days

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of an instant on the business clock. */
export function businessDay(iso: string, tz: string = PAYMENT_REPORT_TZ): string {
  let fmt = dayFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(tz, fmt);
  }
  return fmt.format(new Date(iso));
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes the zone is ahead of UTC at an instant (New York: −240 / −300). */
function zoneOffsetMinutes(epochMs: number, tz: string): number {
  let fmt = offsetFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(tz, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000);
}

/** The UTC instant the business day `day` starts at (local midnight, DST-aware). */
export function dayStartUtc(day: string, tz: string = PAYMENT_REPORT_TZ): string {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let at = guess - zoneOffsetMinutes(guess, tz) * 60_000;
  // Across a DST switch the offset at the guess and at the answer differ.
  at = guess - zoneOffsetMinutes(at, tz) * 60_000;
  return new Date(at).toISOString();
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isDay = (s: string | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** `YYYY-MM` months from `from` to `to` inclusive, ascending. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The last day of a `YYYY-MM` month. */
export function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Which aggregate rows answer a day range: a month row for every month the
 * range covers whole, day rows for the partial months at its edges. Grouped
 * by year, because the aggregates are partitioned by year.
 */
export function aggregatePlan(
  fromDay: string,
  toDay: string,
): Array<{ year: string; kind: 'M' | 'D'; from: string; to: string }> {
  const plan: Array<{ year: string; kind: 'M' | 'D'; from: string; to: string }> = [];
  for (const month of monthsBetween(fromDay.slice(0, 7), toDay.slice(0, 7))) {
    const first = `${month}-01`;
    const last = lastDayOf(month);
    const start = fromDay > first ? fromDay : first;
    const end = toDay < last ? toDay : last;
    if (start === first && end === last) {
      plan.push({ year: month.slice(0, 4), kind: 'M', from: month, to: month });
    } else {
      plan.push({ year: month.slice(0, 4), kind: 'D', from: start, to: end });
    }
  }
  // Merge neighbours of the same kind in the same year into one key range.
  const merged: typeof plan = [];
  for (const p of plan) {
    const prev = merged[merged.length - 1];
    if (prev && prev.year === p.year && prev.kind === p.kind && p.kind === 'M') {
      prev.to = p.to;
    } else {
      merged.push({ ...p });
    }
  }
  return merged;
}

// --------------------------------------------------------------------- CSV

/** Workiz's CSV columns, in Workiz's order (not the table's). */
export const PAYMENT_REPORT_CSV_HEADERS = [
  'Job ID',
  'Document',
  'Payment type',
  'Status',
  'Amount',
  'Service Fee',
  'Net',
  'Tips',
  'Technician',
  'Client name',
  'Transaction method',
  'Card',
  'Payment date',
  'Payment time',
  'Collected by',
  'Description',
  'Job type',
  'Job status',
  'Confirmation code',
] as const;

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const money2 = (n: number | undefined): string => (typeof n === 'number' ? n.toFixed(2) : '');

/** MM/DD/YYYY and h:mm AM/PM on the business clock, as Workiz writes them. */
export function csvDateTime(iso: string, tz: string = PAYMENT_REPORT_TZ): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { timeZone: tz, month: '2-digit', day: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  return { date, time };
}

/** Workiz writes "Paid" where the table says Succeeded; offline lines are paid too. */
function csvStatus(status: PaymentReportStatus | undefined, amount: number, type: string): string {
  if (status === 'pending') return 'Pending';
  if (status === 'failed') return 'Failed';
  if (status === 'reversed') return 'Reversed';
  if (type === 'refund' || type === 'refund_offline' || amount < 0) return 'Refunded';
  return 'Paid';
}

export interface CsvRowInput {
  dealNumber?: string;
  type: string;
  status?: PaymentReportStatus;
  amount: number;
  serviceFee?: number;
  net?: number;
  tip: number;
  technicianName?: string;
  clientName?: string;
  transactionMethod?: string;
  card?: string;
  at: string;
  collectedByName?: string;
  description?: string;
  jobTypeName?: string;
  jobStatus?: string;
  confirmationCode?: string;
}

export function csvLine(r: CsvRowInput, tz: string = PAYMENT_REPORT_TZ): string {
  const { date, time } = csvDateTime(r.at, tz);
  return [
    r.dealNumber ?? '',
    r.dealNumber ? `Job ${r.dealNumber}` : '',
    paymentReportTypeLabel(r.type),
    csvStatus(r.status, r.amount, r.type),
    money2(r.amount),
    money2(r.serviceFee ?? 0),
    money2(r.net ?? r.amount),
    money2(r.tip),
    r.technicianName ?? '',
    r.clientName ?? '',
    r.transactionMethod ?? '',
    r.card ?? '',
    date,
    time,
    r.collectedByName ?? '',
    r.description ?? '',
    r.jobTypeName ?? '',
    r.jobStatus ?? '',
    r.confirmationCode ?? '',
  ]
    .map((v) => csvCell(String(v)))
    .join(',');
}

export const csvHeader = (): string => PAYMENT_REPORT_CSV_HEADERS.join(',');
