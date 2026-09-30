import {
  type TimeClockEntry,
  type TimesheetEntryRow,
  type TimesheetJobFilter,
  type TimesheetReportPagination,
  type TimesheetReportRow,
  type TimesheetReportSort,
  type TimesheetReportTotal,
} from '@bitcrm/types';

/*
 * The Timesheets report's arithmetic, kept free of I/O so it can be checked
 * line by line against Workiz's own numbers (see the docs on
 * `packages/types/src/reports/timesheet-report.ts` and the parser's
 * `docs/reports/timesheets.md`, where the rules were measured).
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** An entry's own minutes: 0 while it runs, never negative. */
export function entryMinutes(e: TimeClockEntry): number {
  if (!e.endedAt) return 0;
  if (typeof e.minutes === 'number' && Number.isFinite(e.minutes)) return Math.max(0, e.minutes);
  const ms = Date.parse(e.endedAt) - Date.parse(e.startedAt);
  return ms > 0 ? Math.round(ms / MS_PER_MINUTE) : 0;
}

/** An entry's own cost: its minutes at its own labor rate (Workiz: `time / 60 × labour_cost`). */
export function entryCost(e: TimeClockEntry): number {
  return (entryMinutes(e) / 60) * (e.laborCostPerHour ?? 0);
}

/** Does an entry pass the Jobs filter? Both values (or none) = everything. */
export function passesJobFilter(e: TimeClockEntry, job?: TimesheetJobFilter[]): boolean {
  if (!job?.length || job.length === 2) return true;
  return job[0] === 'with_job' ? Boolean(e.dealId) : !e.dealId;
}

export interface PersonTotals {
  minutes: number;
  grossMinutes: number;
  cost: number;
  grossCost: number;
  jobs: Set<string>;
  entries: number;
}

/**
 * One person's line.
 *
 * Gross = Σ of the entries' own minutes and costs. The net figures lay the
 * closed entries on one line, oldest start first, and take out every stretch
 * an earlier entry already covered — so a shared stretch is paid once, at
 * the rate of the entry that started first. With nothing overlapping, net and
 * gross are equal to the minute.
 */
export function personTotals(entries: TimeClockEntry[]): PersonTotals {
  let grossMinutes = 0;
  let grossCost = 0;
  const jobs = new Set<string>();
  for (const e of entries) {
    grossMinutes += entryMinutes(e);
    grossCost += entryCost(e);
    if (e.dealId) jobs.add(e.dealId);
  }

  const spans = entries
    .filter((e) => e.endedAt)
    .map((e) => ({ s: Date.parse(e.startedAt), t: Date.parse(e.endedAt as string), rate: e.laborCostPerHour ?? 0 }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.t) && x.t > x.s)
    .sort((a, b) => a.s - b.s || a.t - b.t);

  let coveredUntil = -Infinity;
  let overlapMs = 0;
  let overlapCost = 0;
  for (const x of spans) {
    if (x.s < coveredUntil) {
      const shared = Math.min(x.t, coveredUntil) - x.s;
      overlapMs += shared;
      overlapCost += (shared / MS_PER_HOUR) * x.rate;
    }
    coveredUntil = Math.max(coveredUntil, x.t);
  }

  return {
    minutes: Math.max(0, grossMinutes - Math.round(overlapMs / MS_PER_MINUTE)),
    grossMinutes,
    cost: Math.max(0, grossCost - overlapCost),
    grossCost,
    jobs,
    entries: entries.length,
  };
}

export const cents = (n: number): number => Math.round(n * 100) / 100;

export interface PersonLine extends TimesheetReportRow {
  /** The person's distinct jobs — the total row counts them once over everyone. */
  jobIds: Set<string>;
  /**
   * Unrounded money: the total row rounds the sum, not a sum of rounded
   * cents — Workiz's all-time Gross Cost is $34,978.58, the sum of its
   * rounded rows $34,978.59.
   */
  exactCost: number;
  exactGrossCost: number;
}

/** What the server keeps for itself and does not send. */
export function publicRow({ jobIds: _j, exactCost: _c, exactGrossCost: _g, ...row }: PersonLine): TimesheetReportRow {
  return row;
}

export function toLine(
  userId: string,
  name: string,
  clockedIn: boolean,
  t: PersonTotals,
  money: boolean,
): PersonLine {
  return {
    userId,
    name,
    clockedIn,
    minutes: t.minutes,
    grossMinutes: t.grossMinutes,
    ...(money ? { cost: cents(t.cost), grossCost: cents(t.grossCost) } : {}),
    jobs: t.jobs.size,
    entries: t.entries,
    jobIds: t.jobs,
    exactCost: t.cost,
    exactGrossCost: t.grossCost,
  };
}

/** The total row over the lines the filter and search left. */
export function totalOf(lines: PersonLine[], money: boolean): TimesheetReportTotal {
  const jobs = new Set<string>();
  let minutes = 0;
  let grossMinutes = 0;
  let cost = 0;
  let grossCost = 0;
  let entries = 0;
  for (const l of lines) {
    minutes += l.minutes;
    grossMinutes += l.grossMinutes;
    cost += l.exactCost;
    grossCost += l.exactGrossCost;
    entries += l.entries;
    for (const j of l.jobIds) jobs.add(j);
  }
  return {
    minutes,
    grossMinutes,
    ...(money ? { cost: cents(cost), grossCost: cents(grossCost) } : {}),
    jobs: jobs.size,
    entries,
  };
}

/** A person's name as the report prints it. */
export function personName(p: { firstName?: string; lastName?: string; email?: string } | undefined, userId: string): string {
  const full = `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.replace(/\s+/g, ' ').trim();
  return full || p?.email || userId;
}

/** Case-insensitive "any part of the name". */
export function matchesSearch(name: string, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || name.toLowerCase().includes(needle);
}

const byName = (a: TimesheetReportRow, b: TimesheetReportRow): number => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
};

const VALUE: Record<TimesheetReportSort, (r: TimesheetReportRow) => number> = {
  name: () => 0,
  hours: (r) => r.minutes,
  cost: (r) => r.cost ?? 0,
  jobs: (r) => r.jobs,
};

/**
 * Workiz's sort. A tie keeps the name order (ascending) whichever way the
 * column runs — Workiz breaks ties by its numeric user id, which BitCRM does
 * not have, so the name is the stable stand-in.
 */
export function sortLines<T extends TimesheetReportRow>(rows: T[], sort: TimesheetReportSort, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === 'name') return sign * byName(a, b);
    const d = VALUE[sort](a) - VALUE[sort](b);
    return d !== 0 ? sign * d : byName(a, b);
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number): { rows: T[]; pagination: TimesheetReportPagination } {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return {
    rows: slice,
    pagination: { page: p, pageSize, total, pages, from: slice.length ? start + 1 : 0, to: start + slice.length },
  };
}

/** An entry as the opened row lists it. */
export function toEntryRow(e: TimeClockEntry, money: boolean): TimesheetEntryRow {
  return {
    id: e.id,
    userId: e.userId,
    startedAt: e.startedAt,
    ...(e.endedAt ? { endedAt: e.endedAt } : {}),
    open: !e.endedAt,
    minutes: entryMinutes(e),
    ...(money ? { cost: cents(entryCost(e)) } : {}),
    ...(money && e.laborCostPerHour !== undefined ? { laborCostPerHour: e.laborCostPerHour } : {}),
    ...(e.dealId ? { dealId: e.dealId } : {}),
    ...(e.startLocation ? { startLocation: e.startLocation } : {}),
    ...(e.endLocation ? { endLocation: e.endLocation } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
    source: e.source,
  };
}
