import { taxRateKey, taxRateRounded, type TaxReportBasis, type TaxReportRow } from '@bitcrm/types';

/**
 * Pure rules of Workiz's Tax report (`/root/tax_report/`), verified live on
 * 2026-09-29 against the September numbers:
 *
 * - a row is a tax rate — the name and percent the JOBS carried (Workiz
 *   `tax_ref_id`: "AZ 8.60 %" is its own row beside a disabled "AZ 5.6 %");
 * - only jobs whose tax is not zero are counted (CT: 403 jobs, not the
 *   1 592 CT-area jobs of the period);
 * - Accrual: Amount = Σ tax, Taxable = Σ taxable base (after discount),
 *   Non-taxable = Σ (subtotal − taxable base) — NEGATIVE when a discount takes
 *   more off the taxable lines than the untaxed ones add (CT −$981.16);
 * - Paid: a job with money collected in the period counts taxable base ×
 *   rate × min(1, collected / job total) — worked out from the base, not the
 *   job's stored tax, summed unrounded and rounded once per rate (checked
 *   2026-10-09 job by job: SURE NY 202.15, IL CHICAGO 906.69 as Workiz) —
 *   its FULL taxable base, and one job;
 * - Rate prints with two places (8.875 → 8.88).
 */

/** The deal attributes the report reads (a projection of the deal row). */
export const TAX_REPORT_PROJECTION = [
  'id',
  'createdAt',
  'scheduledDate',
  'scheduledEndDate',
  'scheduledTimeSlot',
  'allDay',
  'jobDateUtc',
  'jobEndDateUtc',
  'jobTimezone',
  'assignedTechIds',
  'taxRateName',
  'taxRatePercent',
  'taxPercent',
  'taxSource',
  'totals',
  // Workiz's own figures on an imported job (read while BitCRM has not re-priced it).
  'taxAmount',
  'taxableAmount',
  'subTotal',
  'jobTotalPrice',
] as const;

export interface TaxDealRow {
  id: string;
  assignedTechIds?: string[];
  taxRateName?: string;
  taxRatePercent?: number;
  taxPercent?: number;
  taxSource?: string;
  totals?: { subtotal?: number; tax?: number; total?: number; taxableBase?: number; source?: string };
  taxAmount?: number;
  taxableAmount?: number;
  subTotal?: number;
  jobTotalPrice?: number;
}

/** One job's tax, the way the report counts it. */
export interface DealTaxFigures {
  dealId: string;
  key: string;
  name: string;
  percent: number;
  tax: number;
  taxable: number;
  subtotal: number;
  total: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const cents = (n: number): number => Math.round((n + Math.sign(n) * Number.EPSILON) * 100);

/**
 * A job's tax figures, or `null` when it carries no tax (exempt, no rate,
 * zero tax) — such a job is not in the report at all.
 *
 * Which numbers: a job priced by BitCRM has its own snapshot (`totals`, with
 * `taxableBase`); a job imported from Workiz and never re-priced here keeps
 * Workiz's (`taxAmount`, `taxableAmount`, `subTotal`, `jobTotalPrice` — its
 * `totals.source` says `workiz`). A snapshot from before `taxableBase` was
 * kept derives the base from the tax.
 */
export function dealTaxFigures(row: TaxDealRow): DealTaxFigures | null {
  if (row.taxSource === 'exempt') return null;
  const t = row.totals;
  const native = !!t && t.source !== 'workiz';
  const percent = num(row.taxRatePercent) ?? num(row.taxPercent) ?? 0;
  const tax = (native ? num(t?.tax) : num(row.taxAmount) ?? num(t?.tax)) ?? 0;
  if (cents(tax) === 0) return null;
  const derived = percent > 0 ? cents((tax * 100) / percent) / 100 : 0;
  const taxable = (native ? num(t?.taxableBase) : num(row.taxableAmount)) ?? derived;
  const subtotal = (native ? num(t?.subtotal) : num(row.subTotal) ?? num(t?.subtotal)) ?? 0;
  const total = (native ? num(t?.total) : num(row.jobTotalPrice) ?? num(t?.total)) ?? 0;
  const name = (row.taxRateName ?? '').trim();
  return { dealId: row.id, key: taxRateKey(name, percent), name, percent, tax, taxable, subtotal, total };
}

interface Acc {
  name: string;
  percent: number;
  amountC: number;
  taxableC: number;
  nonTaxableC: number;
  jobs: number;
  /** Paid: the unrounded sum of the jobs' shares. */
  paidRaw: number;
}

const newAcc = (j: DealTaxFigures): Acc => ({ name: j.name, percent: j.percent, amountC: 0, taxableC: 0, nonTaxableC: 0, jobs: 0, paidRaw: 0 });

const toRow = (a: Acc, basis: TaxReportBasis): TaxReportRow => ({
  key: taxRateKey(a.name, a.percent),
  name: a.name,
  description: '',
  rate: taxRateRounded(a.percent),
  ratePercent: a.percent,
  amount: a.amountC / 100,
  taxableAmount: a.taxableC / 100,
  ...(basis === 'accrual' && { nonTaxableAmount: a.nonTaxableC / 100 }),
  jobs: a.jobs,
});

/** Accrual: every taxed job of the window, summed per rate (in cents). */
export function accrualRows(jobs: DealTaxFigures[]): TaxReportRow[] {
  const by = new Map<string, Acc>();
  for (const j of jobs) {
    const a = by.get(j.key) ?? newAcc(j);
    a.amountC += cents(j.tax);
    a.taxableC += cents(j.taxable);
    a.nonTaxableC += cents(j.subtotal) - cents(j.taxable);
    a.jobs++;
    by.set(j.key, a);
  }
  return [...by.values()].map((a) => toRow(a, 'accrual'));
}

/**
 * The collected share of a job's tax, as Workiz's Paid tab works it out:
 * taxable base × rate × min(1, collected / total), NOT rounded (the row
 * rounds its sum once). Nothing collected (or a period that only refunded)
 * → not counted.
 */
export function paidShare(j: Pick<DealTaxFigures, 'taxable' | 'percent' | 'total'>, collected: number): number | null {
  if (!(collected > 0)) return null;
  const share = j.total > 0 ? Math.min(1, collected / j.total) : 1;
  return ((j.taxable * j.percent) / 100) * share;
}

/** Paid: the jobs that collected money in the window, their tax share, their full taxable base. */
export function paidRows(jobs: Array<{ figures: DealTaxFigures; collected: number }>): TaxReportRow[] {
  const by = new Map<string, Acc>();
  for (const { figures: j, collected } of jobs) {
    const share = paidShare(j, collected);
    if (share === null) continue;
    const a = by.get(j.key) ?? newAcc(j);
    a.paidRaw += share;
    a.taxableC += cents(j.taxable);
    a.jobs++;
    by.set(j.key, a);
  }
  return [...by.values()].map((a) => toRow({ ...a, amountC: cents(a.paidRaw) }, 'paid'));
}

const collator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });

/** Workiz's order: Accrual A→Z by name, Paid Z→A (the two tabs really differ), then by rate. */
export function sortTaxRows(rows: TaxReportRow[], basis: TaxReportBasis): TaxReportRow[] {
  const sign = basis === 'paid' ? -1 : 1;
  return [...rows].sort((a, b) => sign * collator.compare(a.name, b.name) || a.ratePercent - b.ratePercent);
}

/** One "Tax to show" option: a rate by its name (Workiz labels them by name alone). */
export interface TaxOption {
  key: string;
  name: string;
  rate: number;
}

/**
 * "Tax to show": every tax the account has — Workiz lists all of
 * `crud.taxes`, archived ones too, whatever the period — plus any rate the
 * window's jobs carried that the account no longer has; once per name and
 * percent (several service areas share one tax), A→Z, then by rate.
 */
export function taxOptions(windowRows: TaxReportRow[], accountRates: Array<{ name: string; ratePercent: number }>): TaxOption[] {
  const byKey = new Map<string, { name: string; ratePercent: number }>();
  for (const r of accountRates) {
    const name = (r.name ?? '').trim();
    byKey.set(taxRateKey(name, r.ratePercent), { name, ratePercent: Number(r.ratePercent ?? 0) });
  }
  for (const r of windowRows) byKey.set(r.key, { name: r.name, ratePercent: r.ratePercent });
  return [...byKey.entries()]
    .sort(([, a], [, b]) => collator.compare(a.name, b.name) || a.ratePercent - b.ratePercent)
    .map(([key, r]) => ({ key, name: r.name, rate: taxRateRounded(r.ratePercent) }));
}

/** "Tax to show" and the search box. */
export function filterTaxRows(rows: TaxReportRow[], opts: { tax?: string; search?: string }): TaxReportRow[] {
  const q = opts.search?.trim().toLowerCase();
  return rows.filter((r) => (!opts.tax || r.key === opts.tax) && (!q || r.name.toLowerCase().includes(q)));
}

export const sumAmount = (rows: TaxReportRow[]): number => rows.reduce((s, r) => s + cents(r.amount), 0) / 100;

// ------------------------------------------------------------------- CSV

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Workiz's CSV headers — numbers go out bare, no `$` and no `%`. */
export const TAX_CSV_HEADERS: Record<TaxReportBasis, readonly string[]> = {
  accrual: ['Name', 'Description', 'Rate', 'Amount', 'Taxable amount', 'Non taxable amount', 'Jobs count'],
  paid: ['Name', 'Description', 'Rate', 'Tax', 'Taxable amount', 'Jobs count'],
};

export function taxCsvLine(r: TaxReportRow, basis: TaxReportBasis): string {
  const cells =
    basis === 'accrual'
      ? [r.name, r.description, r.rate.toFixed(2), r.amount.toFixed(2), r.taxableAmount.toFixed(2), (r.nonTaxableAmount ?? 0).toFixed(2), String(r.jobs)]
      : [r.name, r.description, r.rate.toFixed(2), r.amount.toFixed(2), r.taxableAmount.toFixed(2), String(r.jobs)];
  return cells.map(csvCell).join(',');
}
