import type {
  JobsReportPagination,
  TipsReportFilters,
  TipsReportJobRow,
  TipsReportJobSort,
  TipsReportRow,
} from '@bitcrm/types';
import { REPORT_PROJECTION, inWindow, isReportable, paginate, toReportDeal, type ReportDeal } from './jobs-report.logic';

/**
 * The Tips report's own logic — pure, so the endpoint and the offline check
 * against Workiz's numbers (`scripts/verify-tips-report.ts`) run exactly the
 * same code over a window of deal rows.
 *
 *   window rows ─ toTipsDeal ─▶ TipsDeal ─ keptJobs ─▶ tipsByTech (one line a person)
 *                                                  └─▶ jobsOfTech (one person's jobs)
 *
 * What Workiz does, checked live on 2026-09-30 (parser `docs/reports/tips.md`):
 * the period is on the JOB DATE; every job counts whatever its status
 * (Canceled too); a job's tip is split equally between everyone assigned to
 * it, unrounded — $64.61 on two people is $32.305 each — and each of them
 * counts the job once. The sums are rounded to the cent only when printed.
 */

/** The Jobs report's window, plus the tip. */
export const TIPS_PROJECTION: readonly string[] = [...REPORT_PROJECTION, 'tipAmount'];

/** A job as the Tips report holds it. */
export interface TipsDeal extends ReportDeal {
  /**
   * The job's tip in cents: Workiz's `tip_amount` on an imported job (the
   * `tipAmount` the import writes, else its `totals.tip`). A job created
   * here has none — BitCRM does not take tips yet (Payment settings: "the
   * tip step isn't built yet").
   */
  tipCents: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const toCents = (dollars: number): number => Math.round(Number((dollars * 100).toFixed(2)));

export function toTipsDeal(item: Record<string, unknown>): TipsDeal {
  const totals = (item.totals ?? {}) as Record<string, unknown>;
  const tip = num(item.tipAmount) ?? num(totals.tip) ?? 0;
  return { ...toReportDeal(item), tipCents: tip > 0 ? toCents(tip) : 0 };
}

/**
 * The jobs a period's report is made of: on the job date, any status, with
 * someone assigned — narrowed by Job type and Client. The Tech filter picks
 * rows, not jobs (a job's tip is split between everyone on it regardless),
 * so it is applied by the callers.
 */
export function keptJobs(deals: readonly TipsDeal[], from: string, to: string, f: TipsReportFilters): TipsDeal[] {
  const types = f.jobTypeId?.length ? new Set(f.jobTypeId) : undefined;
  const clients = f.contactId?.length ? new Set(f.contactId) : undefined;
  return deals.filter(
    (d) =>
      isReportable(d) &&
      d.techIds.length > 0 &&
      inWindow(d, 'scheduled', from, to) &&
      (!types || (d.jobTypeId !== undefined && types.has(d.jobTypeId))) &&
      (!clients || clients.has(d.contactId)),
  );
}

/** The people a row may be shown for: the Tech filter, and `assigned_only` (only themselves). */
export function techAllowed(techId: string, f: TipsReportFilters, own?: string): boolean {
  if (own !== undefined && techId !== own) return false;
  return !f.techId?.length || f.techId.includes(techId);
}

/** Unique people on a job — a duplicated assignment must not halve anyone's share. */
const peopleOf = (d: TipsDeal): string[] => [...new Set(d.techIds)];

/**
 * A share, summed and then rounded to the cent, half up — what Workiz's
 * page prints for a float like 32.305 (Intl rounds the shortest decimal,
 * half away from zero). The epsilon absorbs thirds and sixths that sum back
 * to a whole cent or a half.
 */
export const shareToDollars = (cents: number): number => Math.round(cents + 1e-6) / 100;

export interface TechTotals {
  techId: string;
  /** Cents, unrounded (a sum of shares). */
  tipCents: number;
  jobs: number;
}

/** One line a person: their shares of the kept jobs' tips, and how many jobs they are on. */
export function tipsByTech(jobs: readonly TipsDeal[], f: TipsReportFilters, own?: string): TechTotals[] {
  const byTech = new Map<string, TechTotals>();
  for (const d of jobs) {
    const people = peopleOf(d);
    const share = d.tipCents / people.length;
    for (const techId of people) {
      if (!techAllowed(techId, f, own)) continue;
      const t = byTech.get(techId) ?? { techId, tipCents: 0, jobs: 0 };
      t.tipCents += share;
      t.jobs += 1;
      byTech.set(techId, t);
    }
  }
  return [...byTech.values()];
}

export function toTechRow(t: TechTotals, name: string, money: boolean): TipsReportRow {
  return { techId: t.techId, name, tips: money ? shareToDollars(t.tipCents) : null, jobs: t.jobs };
}

/* ------------------------------------------------------------ one person */

/** Names for a person's jobs. A miss prints as blank. */
export interface JobLookups {
  jobTypes: Map<string, string>;
  clients: Map<string, string>;
}

/** One person's jobs of the kept ones, as rows — their share of each tip. */
export function jobsOfTech(jobs: readonly TipsDeal[], techId: string, lk: JobLookups, money: boolean): TipsReportJobRow[] {
  const out: TipsReportJobRow[] = [];
  for (const d of jobs) {
    const people = peopleOf(d);
    if (!people.includes(techId)) continue;
    out.push({
      dealId: d.id,
      jobNumber: d.jobNumber,
      jobName: d.jobName,
      contactId: d.contactId,
      client: d.clientName ?? lk.clients.get(d.contactId) ?? '',
      date: d.scheduled,
      jobTypeId: d.jobTypeId,
      jobType: (d.jobTypeId && lk.jobTypes.get(d.jobTypeId)) || '',
      total: money ? d.total : null,
      tip: money ? shareToDollars(d.tipCents / people.length) : null,
      people: people.length,
    });
  }
  return out;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * Workiz lists a person's jobs by its internal job id — the order they were
 * created in. Here: imported jobs by their Workiz serial (the same order),
 * then jobs created in BitCRM (which have none and are all newer) by when
 * they were created.
 */
function defaultOrder(serials: Map<string, number | undefined>, created: Map<string, string>) {
  return (a: TipsReportJobRow, b: TipsReportJobRow): number => {
    const sa = serials.get(a.dealId);
    const sb = serials.get(b.dealId);
    if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
    if (sa !== undefined && sb === undefined) return -1;
    if (sa === undefined && sb !== undefined) return 1;
    const ca = created.get(a.dealId) ?? '';
    const cb = created.get(b.dealId) ?? '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.dealId < b.dealId ? -1 : a.dealId > b.dealId ? 1 : 0;
  };
}

function sortValue(r: TipsReportJobRow, column: Exclude<TipsReportJobSort, 'default'>): string | number {
  switch (column) {
    case 'job': return r.jobNumber;
    case 'jobName': return r.jobName ?? '';
    case 'client': return r.client;
    case 'date': return r.date ?? '';
    case 'jobType': return r.jobType;
    case 'total': return r.total ?? 0;
    case 'tip': return r.tip ?? 0;
    default: return '';
  }
}

/**
 * A person's jobs in order. Every column sorts — Workiz's own "Date" header
 * breaks its table (the server answers nothing); here it sorts by the job
 * date. Ties keep the default order.
 */
export function sortJobs(
  rows: TipsReportJobRow[],
  deals: readonly TipsDeal[],
  column: TipsReportJobSort,
  dir: 'asc' | 'desc',
): TipsReportJobRow[] {
  const serials = new Map(deals.map((d) => [d.id, d.jobSerial]));
  const created = new Map(deals.map((d) => [d.id, d.createdAt]));
  const base = defaultOrder(serials, created);
  const sign = dir === 'asc' ? 1 : -1;
  if (column === 'default') return [...rows].sort((a, b) => base(a, b) * sign);
  return [...rows].sort((a, b) => {
    const ka = sortValue(a, column);
    const kb = sortValue(b, column);
    const c =
      typeof ka === 'number' && typeof kb === 'number'
        ? ka - kb
        : column === 'date'
          ? (ka < kb ? -1 : ka > kb ? 1 : 0)
          : collator.compare(String(ka), String(kb));
    return c !== 0 ? c * sign : base(a, b);
  });
}

export function pageOfJobs(
  rows: TipsReportJobRow[],
  page: number,
  pageSize: number,
): { rows: TipsReportJobRow[]; pagination: JobsReportPagination } {
  return paginate(rows, page, pageSize);
}
