import {
  JobSuperStatus,
  type JobStatistics,
  type JobStatisticsBy,
  type JobStatisticsDay,
  type JobStatisticsKpis,
  type JobStatisticsRow,
  type JobStatisticsTab,
  type JobStatisticsTable,
  type JobStatisticsTotals,
} from '@bitcrm/types';
import { REPORT_PROJECTION, dayOfReport, toReportDeal, type ReportDeal } from './jobs-report.logic';
import { shiftDay } from './report-dates';

/**
 * Job Statistics' own logic — pure, so the endpoint and the offline check
 * against Workiz's numbers (`scripts/verify-job-statistics.ts`) run exactly
 * the same code. The period, its window read and its filters are the Jobs
 * report's (`jobs-report.logic.ts`, `report-dates.ts`); what is added here is
 * the money a statistic needs and the grouping of Workiz's five tabs.
 *
 *   window rows ─ toStatsDeal ─▶ StatsDeal ─ (profit of jobs done here) ─▶ aggregateJobStatistics
 */

/**
 * The Jobs report's attributes plus what the money needs: tax, parts, labour,
 * Workiz's frozen commission row, and — for a job done here, whose profit is
 * computed with the Workiz formula — its rate override and custom fields.
 */
export const STATS_PROJECTION: readonly string[] = [
  ...new Set([
    ...REPORT_PROJECTION,
    'invoiceId',
    'taxAmount',
    'tipAmount',
    'parts',
    'companyParts',
    'totalLabourCost',
    'customFields',
    'useTechSpecialRate',
    'techSpecialRate',
    'techSpecialRateUnit',
    'commissionSnapshot',
  ]),
];

export type ProfitSource = 'workiz' | 'computed';

/** A job as Job Statistics holds it — the Jobs report's compact job plus its money. */
export interface StatsDeal extends ReportDeal {
  /**
   * A Done job's company profit after the technician's share. Workiz's own
   * figure on an imported job (`commissionSnapshot.companyProfit`); on a job
   * done here it is filled in by the service from the Workiz formula.
   */
  profit?: number;
  profitSource?: ProfitSource;
  /** Tech parts — Workiz's "Tech expenses". */
  parts: number;
  /** Timesheet labour cost — Workiz's "Labor cost" (0 in this account). */
  laborCost: number;
  /**
   * The raw row of a Done job whose profit is still to be computed — the
   * formula needs attributes the compact job does not keep. Dropped once the
   * profit is in.
   */
  pending?: Record<string, unknown>;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A window row → the statistics' job. */
export function toStatsDeal(item: Record<string, unknown>): StatsDeal {
  const base = toReportDeal(item);
  const snapshot = item.commissionSnapshot as { companyProfit?: unknown } | undefined;
  const done = base.superStatus === JobSuperStatus.DONE;
  const frozen = done && snapshot && typeof snapshot === 'object' ? num(Number(snapshot.companyProfit)) : undefined;
  return {
    ...base,
    parts: num(item.parts) ?? 0,
    laborCost: num(item.totalLabourCost) ?? 0,
    ...(frozen !== undefined && { profit: frozen, profitSource: 'workiz' as const }),
    ...(done && frozen === undefined && { pending: item }),
  };
}

/* ---------------------------------------------------------------- names */

/** Names for the ids a job carries. A miss never prints an id. */
export interface StatsLookups {
  /** Technicians and creators. */
  users: Map<string, string>;
  /** Job source (Workiz ad group) → its name and description. */
  sources: Map<string, { name: string; description?: string }>;
  externalCompanies: Map<string, string>;
  serviceAreas: Map<string, string>;
  jobTypes: Map<string, string>;
}

export const emptyStatsLookups = (): StatsLookups => ({
  users: new Map(),
  sources: new Map(),
  externalCompanies: new Map(),
  serviceAreas: new Map(),
  jobTypes: new Map(),
});

/* --------------------------------------------------------------- groups */

interface Group {
  key: string;
  label: string;
  kind?: 'ad' | 'external';
  techIds?: string[];
}

/**
 * Sources, Workiz's way (checked live, 126 rows = 126): a job that came from
 * an external company is that company's row; any other job is its ad group's,
 * named by the group's description when it has one, else its name — and
 * groups that share a description are one row ("transferred from A1 account"
 * is seven A-1 CT groups).
 */
export function sourceGroup(d: StatsDeal, lk: StatsLookups): Group {
  if (d.externalCompanyId) {
    return { key: `external:${d.externalCompanyId}`, label: lk.externalCompanies.get(d.externalCompanyId) ?? '', kind: 'external' };
  }
  if (d.sourceId) {
    const s = lk.sources.get(d.sourceId);
    if (!s) return { key: `ad-id:${d.sourceId}`, label: '', kind: 'ad' };
    const label = (s.description?.trim() || s.name || '').trim();
    return { key: `ad:${label}`, label, kind: 'ad' };
  }
  return { key: 'ad:', label: '', kind: 'ad' };
}

/**
 * Tech, Workiz's way (checked live, 60 rows = 60): a job is credited to its
 * whole team as ONE row — "A + B" in assignment order — never to each
 * technician; a job with nobody on it is the "unassigned" row. Every job is
 * in exactly one row, so the rows add up to All.
 */
export function techGroup(d: StatsDeal, lk: StatsLookups): Group {
  if (!d.techIds.length) return { key: 'unassigned', label: '', techIds: [] };
  return {
    key: `tech:${d.techIds.join('+')}`,
    label: d.techIds.map((id) => lk.users.get(id) || 'Unknown user').join(' + '),
    techIds: [...d.techIds],
  };
}

/** The job's service area, or nothing — such a job is in no Area table (Workiz). */
export function areaGroup(d: StatsDeal, lk: StatsLookups): Group | undefined {
  if (d.serviceAreaId) return { key: `area:${d.serviceAreaId}`, label: lk.serviceAreas.get(d.serviceAreaId) || d.serviceArea || '' };
  if (d.serviceArea) return { key: `area-name:${d.serviceArea}`, label: d.serviceArea };
  return undefined;
}

/** Dispatcher = whoever created the job; Workiz's own "Created by" text when BitCRM has no such user. */
export function dispatcherGroup(d: StatsDeal, lk: StatsLookups): Group {
  if (d.createdBy) {
    const name = lk.users.get(d.createdBy);
    if (name || !d.userCreated) return { key: `user:${d.createdBy}`, label: name ?? '' };
  }
  if (d.userCreated) return { key: `text:${d.userCreated}`, label: d.userCreated };
  return { key: 'none', label: '' };
}

export function jobTypeGroup(d: StatsDeal, lk: StatsLookups): Group {
  if (!d.jobTypeId) return { key: 'none', label: '' };
  return { key: `type:${d.jobTypeId}`, label: lk.jobTypes.get(d.jobTypeId) ?? '' };
}

/* ---------------------------------------------------------- accumulators */

export interface StatsOptions {
  /** `financials.view` — without it no amount at all. */
  money: boolean;
  /** Workiz "View Profit" — Profit and Average Profit, on top of `money`. */
  profit: boolean;
  /** The tables this caller may see. */
  tabs: readonly JobStatisticsTab[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const toCents = (n: number | undefined): number => (n === undefined ? 0 : Math.round(n * 100));

/** One row's sums: counts, and the Done jobs' money in whole cents (no float drift across thousands of jobs). */
class Acc {
  all = 0;
  done = 0;
  canceled = 0;
  gross = 0;
  profit = 0;
  parts = 0;
  labor = 0;
  /** How often each companion value (a city's area, a zip's city) occurs — the row prints the commonest. */
  private readonly seen = new Map<string, Map<string, number>>();

  add(d: StatsDeal): void {
    this.all += 1;
    if (d.superStatus === JobSuperStatus.CANCELED) this.canceled += 1;
    if (d.superStatus !== JobSuperStatus.DONE) return;
    this.done += 1;
    this.gross += toCents(d.total);
    this.profit += toCents(d.profit);
    this.parts += toCents(d.parts);
    this.labor += toCents(d.laborCost);
  }

  note(field: string, value: string): void {
    const counts = this.seen.get(field) ?? new Map<string, number>();
    counts.set(value, (counts.get(value) ?? 0) + 1);
    this.seen.set(field, counts);
  }

  commonest(field: string): string | undefined {
    let best: string | undefined;
    let n = 0;
    for (const [value, count] of this.seen.get(field) ?? []) {
      if (count > n || (count === n && best !== undefined && value < best)) {
        best = value;
        n = count;
      }
    }
    return best;
  }

  totals(opts: StatsOptions, techColumns: boolean): JobStatisticsTotals {
    const per = (cents: number): number => (this.done ? Math.round(cents / this.done) / 100 : 0);
    return {
      all: this.all,
      done: this.done,
      open: this.all - this.done - this.canceled,
      canceled: this.canceled,
      canceledPct: this.all ? round2((this.canceled / this.all) * 100) : 0,
      ...(opts.money && {
        gross: this.gross / 100,
        ...(opts.profit && { profit: this.profit / 100 }),
        ...(techColumns && { laborCost: this.labor / 100, techExpenses: this.parts / 100 }),
        avgSale: per(this.gross),
        ...(opts.profit && { avgProfit: per(this.profit) }),
      }),
    };
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** One breakdown: a row per group, in the order Workiz's table opens (most jobs first), and its Totals. */
class Table {
  private readonly rows = new Map<string, { group: Group; acc: Acc }>();
  private readonly total = new Acc();

  constructor(private readonly techColumns = false) {}

  add(group: Group, d: StatsDeal): Acc {
    let row = this.rows.get(group.key);
    if (!row) {
      row = { group, acc: new Acc() };
      this.rows.set(group.key, row);
    }
    row.acc.add(d);
    this.total.add(d);
    return row.acc;
  }

  build(opts: StatsOptions, companions: { serviceArea?: boolean; city?: boolean } = {}): JobStatisticsTable {
    const rows: JobStatisticsRow[] = [...this.rows.values()].map(({ group, acc }) => {
      const serviceArea = companions.serviceArea ? acc.commonest('serviceArea') : undefined;
      const city = companions.city ? acc.commonest('city') : undefined;
      return {
        key: group.key,
        label: group.label,
        ...(group.kind && { kind: group.kind }),
        ...(group.techIds && { techIds: group.techIds }),
        ...(serviceArea !== undefined && { serviceArea }),
        ...(city !== undefined && { city }),
        ...acc.totals(opts, this.techColumns),
      };
    });
    rows.sort((a, b) => b.all - a.all || collator.compare(a.label, b.label) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { rows, totals: this.total.totals(opts, this.techColumns) };
  }
}

/* ------------------------------------------------------------ aggregate */

/** Every day of `from`..`to`, both included. */
export function daysOf(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) days.push(d);
  return days;
}

/**
 * A period of jobs as Workiz's Job Statistics shows it. `deals` are the
 * period's jobs, already windowed, scoped and filtered; a Done job carries
 * its profit (`profit`, company side). Money only with `opts.money`, profit
 * only with `opts.profit` as well; a table only when its tab is in `opts.tabs`.
 */
export function aggregateJobStatistics(
  deals: readonly StatsDeal[],
  window: { by: JobStatisticsBy; from: string; to: string },
  lk: StatsLookups,
  opts: StatsOptions,
): Omit<JobStatistics, 'access' | 'warnings'> {
  const tabs = new Set(opts.tabs);
  const overall = new Acc();
  const byStatus = Object.fromEntries(Object.values(JobSuperStatus).map((s) => [s, 0])) as Record<JobSuperStatus, number>;
  const days = daysOf(window.from, window.to);
  const series = new Map(days.map((date) => [date, { acc: new Acc() }]));
  const sources = new Table();
  const tech = new Table(true);
  const metro = new Table();
  const city = new Table();
  const zip = new Table();
  const dispatcher = new Table();
  const jobTypes = new Table();
  let withoutArea = 0;
  const profitSources = { workiz: 0, computed: 0 };

  for (const d of deals) {
    overall.add(d);
    byStatus[d.superStatus] = (byStatus[d.superStatus] ?? 0) + 1;
    if (d.superStatus === JobSuperStatus.DONE && d.profitSource) profitSources[d.profitSource] += 1;
    const day = series.get(dayOfReport(d, window.by) ?? '');
    day?.acc.add(d);

    if (tabs.has('sources')) sources.add(sourceGroup(d, lk), d);
    if (tabs.has('tech')) tech.add(techGroup(d, lk), d);
    if (tabs.has('dispatcher')) dispatcher.add(dispatcherGroup(d, lk), d);
    if (tabs.has('jobTypes')) jobTypes.add(jobTypeGroup(d, lk), d);
    if (tabs.has('area')) {
      const area = areaGroup(d, lk);
      if (!area) {
        withoutArea += 1;
      } else {
        metro.add(area, d);
        // Workiz groups the City and Zip drills by the city / zip alone and
        // prints one of the group's areas (cities) beside it — the commonest here.
        city.add({ key: `city:${d.city ?? ''}`, label: d.city ?? '' }, d).note('serviceArea', area.label);
        zip.add({ key: `zip:${d.zip ?? ''}`, label: d.zip ?? '' }, d).note('city', d.city ?? '');
      }
    }
  }

  const totals = overall.totals(opts, true);
  const kpis: JobStatisticsKpis = {
    ...totals,
    submitted: byStatus[JobSuperStatus.SUBMITTED] ?? 0,
    inProgress: byStatus[JobSuperStatus.IN_PROGRESS] ?? 0,
    pending: byStatus[JobSuperStatus.PENDING] ?? 0,
    donePendingApproval: byStatus[JobSuperStatus.DONE_PENDING_APPROVAL] ?? 0,
  };

  return {
    window,
    kpis,
    series: days.map((date): JobStatisticsDay => {
      const t = series.get(date)!.acc.totals(opts, false);
      return {
        date,
        jobs: t.all,
        canceled: t.canceled,
        done: t.done,
        ...(opts.money && { sales: t.gross }),
        ...(opts.money && opts.profit && { profit: t.profit }),
      };
    }),
    ...(tabs.has('sources') && { sources: sources.build(opts) }),
    ...(tabs.has('tech') && { tech: tech.build(opts) }),
    ...(tabs.has('area') && {
      area: {
        metro: metro.build(opts),
        city: city.build(opts, { serviceArea: true }),
        zip: zip.build(opts, { city: true }),
        withoutArea,
      },
    }),
    ...(tabs.has('dispatcher') && { dispatcher: dispatcher.build(opts) }),
    ...(tabs.has('jobTypes') && { jobTypes: jobTypes.build(opts) }),
    ...(opts.money && opts.profit && { profitSources }),
  };
}
