import {
  JobSuperStatus,
  SALES_REPORT_COLUMNS,
  type JobsReportBy,
  type SalesReportColumnId,
  type SalesReportDay,
  type SalesReportFilters,
  type SalesReportMoney,
  type SalesReportPaymentStatus,
  type SalesReportRow,
  type SalesReportTotals,
} from '@bitcrm/types';
import {
  REPORT_PROJECTION,
  csvField,
  dayOfReport,
  formatPhone,
  inWindow,
  matchesFilters,
  toReportDeal,
  toRow,
  workizDate,
  type ReportDeal,
  type ReportLookups,
  type RowOptions,
} from './jobs-report.logic';
import { createdAt as createdWall, shiftDay } from './report-dates';

/**
 * The Sales report's own logic — pure, so the endpoint, the CSV export and
 * the offline check against Workiz's numbers (`scripts/verify-sales-report.ts`)
 * run exactly the same code over a window of deal rows. The period, its
 * window read, the names and the job columns are the Jobs report's
 * (`jobs-report.logic.ts`, `report-dates.ts`); what is added here is which
 * jobs are sales, their money, the Total row and the chart.
 *
 *   window rows ─ toSalesDeal ─▶ SalesDeal ─ isSale / inWindow / filters ─▶ toSalesRow ─▶ search / sort / page | CSV
 *                                                                        └▶ salesTotals, salesByDay
 */

/** The Jobs report's attributes plus the money a sale shows. */
export const SALES_PROJECTION: readonly string[] = [
  ...new Set([
    ...REPORT_PROJECTION,
    'subTotal',
    'taxAmount',
    'tipAmount',
    'parts',
    'companyParts',
    'totalLabourCost',
    'cardExpenses',
    'paidTotal',
    'amountPaid',
    'invoiceId',
  ]),
];

/** A job's money in whole cents — no float drift across a year of jobs. */
export type SalesCents = SalesReportMoney;

/** A job as the Sales report holds it — the Jobs report's compact job plus its money. */
export interface SalesDeal extends ReportDeal {
  cents: SalesCents;
  invoiceId?: string;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const toCents = (v: number | undefined): number => (v === undefined ? 0 : Math.round(v * 100));
const firstNumber = (...values: unknown[]): number | undefined => {
  for (const v of values) {
    const n = num(v);
    if (n !== undefined) return n;
  }
  return undefined;
};

/**
 * A job's money, Workiz's way (checked row by row against 1 023 jobs):
 *
 * - Total, Subtotal, Tax, Tip — the job's own snapshot (`totals`, where the
 *   Workiz import writes Workiz's figures), else the importer's flat copies;
 * - Item cost — the company's parts (`companyParts`: Σ qty × cost of the
 *   lines, what Workiz calls `company_parts`). A job made here has no such
 *   field and its `totals.cost` is exactly that sum; an imported snapshot's
 *   `cost` also holds the technician's parts, so it is not used for one;
 * - Tech expenses — the technician's parts (`parts`);
 * - Paid — what billing last asserted (`amountPaid`), else Workiz's paid total;
 * - Due = Total − Paid, below zero when the job is overpaid;
 * - Profit = Total − Tax − Item cost − Tech expenses − Labor cost − Card
 *   expenses: before the technician's share, the tip not taken off.
 */
export function salesMoney(item: Record<string, unknown>): SalesCents {
  const totals = (item.totals ?? {}) as Record<string, unknown>;
  const total = toCents(firstNumber(totals.total, item.jobTotalPrice));
  const subtotal = toCents(firstNumber(totals.subtotal, item.subTotal));
  const tax = toCents(firstNumber(totals.tax, item.taxAmount));
  const tip = toCents(firstNumber(totals.tip, item.tipAmount));
  const techExpenses = toCents(num(item.parts));
  const companyParts = num(item.companyParts);
  const itemCost =
    companyParts !== undefined
      ? toCents(companyParts)
      : totals.source === 'workiz'
        ? Math.max(0, toCents(num(totals.cost)) - techExpenses)
        : toCents(num(totals.cost));
  const laborCost = toCents(num(item.totalLabourCost));
  const cardExpenses = toCents(num(item.cardExpenses));
  const paid = toCents(firstNumber(item.amountPaid, totals.amountPaid, item.paidTotal));
  return {
    total,
    subtotal,
    itemCost,
    laborCost,
    cardExpenses,
    techExpenses,
    paid,
    due: total - paid,
    tax,
    profit: total - tax - itemCost - techExpenses - laborCost - cardExpenses,
    tip,
  };
}

/** A window row (any subset of a deal METADATA item) → the report's compact job. */
export function toSalesDeal(item: Record<string, unknown>): SalesDeal {
  const invoiceId = typeof item.invoiceId === 'string' && item.invoiceId ? item.invoiceId : undefined;
  return { ...toReportDeal(item), cents: salesMoney(item), ...(invoiceId && { invoiceId }) };
}

/**
 * A sale: any status but Canceled, and a total above zero. A job never
 * priced is not a sale whatever its status — Workiz leaves out the 50 Done
 * jobs of 01–27.09 at $0 and every open job at $0, and lists today's open
 * jobs that have a price.
 */
export const isSale = (d: SalesDeal): boolean => d.superStatus !== JobSuperStatus.CANCELED && d.cents.total > 0;

/** Workiz's payment status: Paid when nothing is due, Partly paid when some is paid and some due, else Due. */
export function paymentStatusOf(c: Pick<SalesCents, 'paid' | 'due'>): SalesReportPaymentStatus {
  if (c.due <= 0) return 'paid';
  return c.paid > 0 ? 'partly_paid' : 'due';
}

const some = <T>(list: readonly T[] | undefined, pick: (v: T) => boolean): boolean => !list || list.length === 0 || list.some(pick);

/**
 * Workiz's MultiFilter over Status, Team, Job type, Payment status, Source
 * and Service Areas: every group narrows (AND), a group matches any of its
 * values (OR). A job counts whole for each technician on it.
 */
export function matchesSalesFilters(d: SalesDeal, f: SalesReportFilters): boolean {
  // A Workiz stub (an invoice without a job) has no status at all.
  if (d.stub && f.status?.length) return false;
  return (
    matchesFilters(d, {
      status: f.status,
      techId: f.techId,
      jobTypeId: f.jobTypeId,
      sourceId: f.sourceId,
      serviceAreaId: f.serviceAreaId,
    }) && some(f.paymentStatus, (v) => paymentStatusOf(d.cents) === v)
  );
}

/** The jobs of a window the report lists: sales, in the period on the chosen date, through the filters. */
export function salesOf(deals: Iterable<SalesDeal>, by: JobsReportBy, from: string, to: string, filters: SalesReportFilters = {}): SalesDeal[] {
  const out: SalesDeal[] = [];
  for (const d of deals) if (isSale(d) && inWindow(d, by, from, to) && matchesSalesFilters(d, filters)) out.push(d);
  return out;
}

/* ------------------------------------------------------------------- money */

const dollars = (cents: number): number => Math.round(cents) / 100;

/** Profit / Total × 100 to two decimals — Workiz's "NN.NN% margin"; 0 on no total. */
export function marginOf(profitCents: number, totalCents: number): number {
  if (!totalCents) return 0;
  return Math.round((profitCents / totalCents) * 10_000) / 100;
}

const MONEY_KEYS = ['total', 'subtotal', 'itemCost', 'laborCost', 'cardExpenses', 'techExpenses', 'paid', 'due', 'tax', 'profit', 'tip'] as const;

function moneyOf(c: SalesCents): SalesReportMoney {
  const out = {} as SalesReportMoney;
  for (const k of MONEY_KEYS) out[k] = dollars(c[k]);
  return out;
}

/* ------------------------------------------------------------------- rows */

/** A compact job → the row the page and the CSV print; money only with `opts.money`. */
export function toSalesRow(d: SalesDeal, lk: ReportLookups, opts: RowOptions): SalesReportRow {
  const j = toRow(d, lk, { ...opts, money: false });
  return {
    id: j.id,
    jobNumber: j.jobNumber,
    ...(d.jobSerial !== undefined && { jobSerial: d.jobSerial }),
    jobName: j.jobName,
    contactId: j.contactId,
    client: j.client,
    clientCompany: j.clientCompany,
    email: j.email,
    ...(j.phone !== undefined && { phone: j.phone }),
    ...(j.phoneMasked && { phoneMasked: true }),
    createdAt: j.createdAt,
    scheduled: j.scheduled,
    end: j.end,
    superStatus: j.superStatus,
    // A Workiz stub has no status; Workiz prints the cell empty.
    status: d.stub ? '' : j.status,
    subStatusId: j.subStatusId,
    subStatus: j.subStatus,
    jobTypeId: j.jobTypeId,
    type: j.type,
    techIds: j.techIds,
    tech: j.tech,
    sourceId: j.sourceId,
    source: j.source,
    ...(d.invoiceId && { invoiceId: d.invoiceId }),
    serviceAreaId: j.serviceAreaId,
    serviceArea: j.serviceArea,
    ...(opts.money && { ...moneyOf(d.cents), margin: marginOf(d.cents.profit, d.cents.total) }),
  };
}

/** Workiz's bold first row over the jobs kept: the count and, with money, every sum and the margin. */
export function salesTotals(deals: readonly SalesDeal[], money: boolean): SalesReportTotals {
  if (!money) return { jobs: deals.length };
  const sum = Object.fromEntries(MONEY_KEYS.map((k) => [k, 0])) as unknown as SalesCents;
  for (const d of deals) for (const k of MONEY_KEYS) sum[k] += d.cents[k];
  return { jobs: deals.length, ...moneyOf(sum), margin: marginOf(sum.profit, sum.total) };
}

/**
 * The chart: Σ Total ("Sales") and Σ Profit per day on the chosen date,
 * every day of the period — an empty day is a zero, not a gap.
 */
export function salesByDay(deals: readonly SalesDeal[], by: JobsReportBy, from: string, to: string): SalesReportDay[] {
  const days = new Map<string, { sales: number; profit: number }>();
  for (let day = from; day <= to && days.size < 400; day = shiftDay(day, 1)) days.set(day, { sales: 0, profit: 0 });
  for (const d of deals) {
    const day = dayOfReport(d, by);
    const acc = day ? days.get(day) : undefined;
    if (!acc) continue;
    acc.sales += d.cents.total;
    acc.profit += d.cents.profit;
  }
  return [...days].map(([day, v]) => ({ day, sales: dollars(v.sales), profit: dollars(v.profit) }));
}

/* ----------------------------------------------------------------- search */

/**
 * The search box, as Workiz's (checked live): any part of the job number
 * (its code and its Workiz serial), the invoice number — here the job's own —
 * the client's name, company or email, and the job name. Not the phone:
 * Workiz finds nothing for a client's number.
 */
export function matchesSalesSearch(row: SalesReportRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [row.jobNumber, row.jobSerial !== undefined ? String(row.jobSerial) : '', row.jobName, row.client, row.clientCompany, row.email];
  return hay.some((v) => v && v.toLowerCase().includes(needle));
}

/* ------------------------------------------------------------------- sort */

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** What a text column sorts on — its printed text. */
function textKey(row: SalesReportRow, column: SalesReportColumnId): string {
  switch (column) {
    case 'jobName': return row.jobName ?? '';
    case 'client': return row.client;
    case 'scheduled': return row.scheduled ?? '';
    case 'end': return row.end ?? '';
    case 'status': return `${row.status} ${row.subStatus ?? ''}`;
    case 'type': return row.type;
    case 'tech': return row.tech.join(', ');
    case 'source': return row.source ?? '';
    case 'invoice': return row.invoiceId ? row.jobNumber : '';
    case 'serviceArea': return row.serviceArea ?? '';
    default: return '';
  }
}

const isMoney = (column: SalesReportColumnId): column is keyof SalesReportMoney => (MONEY_KEYS as readonly string[]).includes(column);

/**
 * Newest first by the Job ID — Workiz's default (`job_serial desc`). An
 * imported job keeps its Workiz serial; a job made here has none and is newer
 * than every one of them, so it sorts above them, by when it was created.
 */
function compareJobNumber(a: SalesReportRow, b: SalesReportRow): number {
  const ha = a.jobSerial !== undefined;
  const hb = b.jobSerial !== undefined;
  if (ha && hb) return a.jobSerial! - b.jobSerial!;
  if (ha !== hb) return ha ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** Server-side sort on any column; ties newest-created first, then by id — stable across pages. */
export function sortSalesRows(rows: SalesReportRow[], column: SalesReportColumnId, dir: 'asc' | 'desc'): SalesReportRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const out = [...rows];
  out.sort((a, b) => {
    let c: number;
    if (column === 'jobNumber') c = compareJobNumber(a, b);
    else if (column === 'created') c = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    else if (isMoney(column)) c = (a[column] ?? 0) - (b[column] ?? 0);
    else c = collator.compare(textKey(a, column), textKey(b, column));
    if (c !== 0) return c * sign;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/* -------------------------------------------------------------------- CSV */

const LABEL = new Map<string, string>(SALES_REPORT_COLUMNS.map((c) => [c.id, c.label]));

const amount = (n: number | undefined): string => (n === undefined ? '' : n.toFixed(2));

/** The printed text of one cell — the file reads like the grid. */
export function salesCellText(row: SalesReportRow, column: SalesReportColumnId): string {
  if (isMoney(column)) return amount(row[column]);
  switch (column) {
    case 'jobNumber': return row.jobNumber;
    case 'client': {
      const extra = row.email || (row.phone ? formatPhone(row.phone) : '') || row.clientCompany;
      return extra && extra !== row.client ? `${row.client} (${extra})` : row.client;
    }
    case 'created': return workizDate(createdWall({ createdAt: row.createdAt }));
    case 'scheduled': return workizDate(row.scheduled);
    case 'end': return workizDate(row.end);
    case 'status': return row.subStatus ? `${row.status} - ${row.subStatus}` : row.status;
    default: return textKey(row, column);
  }
}

export function salesCsvHeader(columns: readonly SalesReportColumnId[]): string {
  return columns.map((c) => csvField(LABEL.get(c) ?? c)).join(',');
}

export function salesCsvLine(row: SalesReportRow, columns: readonly SalesReportColumnId[]): string {
  return columns.map((c) => csvField(salesCellText(row, c), isMoney(c))).join(',');
}

/** The grid's first row in the file: "Total:" under the first column, the sums under theirs. */
export function salesCsvTotalsLine(totals: SalesReportTotals, columns: readonly SalesReportColumnId[]): string {
  return columns.map((c, i) => (isMoney(c) ? amount(totals[c]) : i === 0 ? 'Total:' : '')).join(',');
}
