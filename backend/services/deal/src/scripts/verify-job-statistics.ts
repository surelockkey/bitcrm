/**
 * Check Job Statistics against Workiz — offline, read-only.
 *
 * WHY
 * ---
 * The report must give the numbers Workiz gives for the same period. Workiz
 * was read live on 2026-09-29 (~22:15 Asia/Jerusalem) for 2026-09-01..27
 * (`workiz-data-parser/docs/reports/job-statistics.md`, «Перевірено наживо»;
 * the raw answers are `live_verification_2026-09-01_27.json`).
 *
 * This runs the endpoint's own code (`job-statistics.logic.ts` over the Jobs
 * report's window of `report-dates.ts`) over the deal rows of a Workiz import
 * package — the very items the importer writes to DynamoDB — and prints the
 * KPIs, every tab's Totals and the Area table beside Workiz's. Given the Jobs
 * report's per-row capture of the same evening (`--workiz-jobs`) it also
 * names every job that is on one side only or in another status: a job
 * edited in Workiz after the capture.
 *
 * Names: the endpoint prints BitCRM's user names; to match Workiz's rows the
 * check prints the name each user had in Workiz (`workizName` of the users
 * package), where there is one.
 *
 * Nothing is written anywhere; the package is only read.
 *
 * USAGE
 * -----
 *   npm run verify:job-statistics -w backend/services/deal -- \
 *     --package <dir of deals/part-*.jsonl> [--users <dir of users/part-*.jsonl>] \
 *     [--from 2026-09-01 --to 2026-09-27] [--workiz <statistics capture.json>] [--workiz-jobs <jobs capture.json>] [--service]
 *
 * `--service` runs By Closed once more through `JobStatisticsService` over a
 * real `DealsRepository` whose DynamoDB is the report indexes in memory
 * (`jobs-report-in-memory.ts`, GSI7 stamped as `backfill:end-index` would)
 * and says whether it gives the same figures.
 */
import { createReadStream, existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { createInterface } from 'readline';
import {
  JOB_STATISTICS_TABS,
  JOBS_REPORT_DEFAULT_SETTINGS,
  type JobStatistics,
  type JobStatisticsBy,
  type JobStatisticsRow,
  type JobStatisticsTable,
  type JobStatisticsTotals,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { DealsRepository } from '../deals/deals.repository';
import { dayOfReport, inWindow, isReportable } from '../deals/report/jobs-report.logic';
import { JobsReportService } from '../deals/report/jobs-report.service';
import { JobStatisticsService } from '../deals/report/job-statistics.service';
import type { JobsReportQueryDto } from '../deals/report/jobs-report.query';
import {
  STATS_PROJECTION,
  aggregateJobStatistics,
  emptyStatsLookups,
  toStatsDeal,
  type StatsDeal,
  type StatsLookups,
} from '../deals/report/job-statistics.logic';
import { shiftDay } from '../deals/report/report-dates';
import { InMemoryReportIndexes } from './jobs-report-in-memory';

type Item = Record<string, unknown>;
type Cell = string | number;

const REPORT_BY: Record<JobStatisticsBy, string> = { created: '1', scheduled: '2', end: '3' };
const JOBS_KEY: Record<JobStatisticsBy, string> = { created: 'created', scheduled: 'job_date', end: 'job_end_date' };
const STATUS: Record<string, string> = {
  Submitted: 'submitted',
  'In progress': 'in_progress',
  Done: 'done',
  Pending: 'pending',
  'done pending approval': 'done_pending_approval',
  Canceled: 'canceled',
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const n = (v: Cell | undefined): number => (typeof v === 'number' ? v : Number(String(v ?? '0').replace(/[,%\s]/g, '')) || 0);
const money = (v: number | undefined): string =>
  v === undefined ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

async function* lines(dir: string): AsyncGenerator<string> {
  const parts = readdirSync(dir).filter((f) => /^part-.*\.jsonl$/.test(f)).sort();
  if (!parts.length) throw new Error(`No part-*.jsonl in ${dir}`);
  for (const part of parts) {
    yield* createInterface({ input: createReadStream(join(dir, part)), crlfDelay: Infinity });
  }
}

/** A row's dates touch `from`..`to` (padded) — enough for any "By". */
function near(item: Item, from: string, to: string): boolean {
  const lo = shiftDay(from, -45);
  const hi = shiftDay(to, 45);
  return ['createdAt', 'scheduledDate', 'scheduledEndDate', 'jobDateUtc', 'jobEndDateUtc'].some((k) => {
    const v = typeof item[k] === 'string' ? (item[k] as string).slice(0, 10) : '';
    return v >= lo && v <= hi;
  });
}

interface Package {
  rows: Item[];
  deals: StatsDeal[];
  workizIdOf: Map<string, string>;
  lookups: StatsLookups;
  bitcrmNames: Map<string, string>;
}

async function readPackage(dir: string, usersDir: string | undefined, from: string, to: string): Promise<Package> {
  const rows: Item[] = [];
  const workizIdOf = new Map<string, string>();
  const lookups = emptyStatsLookups();
  const projected = [...STATS_PROJECTION, 'workizId', 'GSI1PK', 'GSI1SK'];
  for await (const line of lines(dir)) {
    if (line.startsWith('{"PK":"DEAL#')) {
      if (!line.slice(0, 200).includes('"SK":"METADATA"')) continue;
      const item = JSON.parse(line) as Item;
      if (item.SK !== 'METADATA' || item.status !== 'active' || !near(item, from, to)) continue;
      rows.push(Object.fromEntries(projected.filter((k) => item[k] !== undefined).map((k) => [k, item[k]])));
      if (item.workizId !== undefined) workizIdOf.set(String(item.id), String(item.workizId));
      continue;
    }
    const catalog = /^\{"PK":"(JOB_SOURCE|EXTERNAL_COMPANY|SERVICE_AREA|JOB_TYPE)#/.exec(line);
    if (!catalog) continue;
    const c = JSON.parse(line) as { id: string; name: string; description?: string; SK: string };
    if (c.SK !== 'METADATA') continue;
    if (catalog[1] === 'JOB_SOURCE') lookups.sources.set(c.id, { name: c.name, ...(c.description?.trim() && { description: c.description }) });
    if (catalog[1] === 'EXTERNAL_COMPANY') lookups.externalCompanies.set(c.id, c.name);
    if (catalog[1] === 'SERVICE_AREA') lookups.serviceAreas.set(c.id, c.name);
    if (catalog[1] === 'JOB_TYPE') lookups.jobTypes.set(c.id, c.name);
  }
  const bitcrmNames = new Map<string, string>();
  if (usersDir && existsSync(usersDir)) {
    for await (const line of lines(usersDir)) {
      if (!line.startsWith('{"PK":"USER#') || !line.slice(0, 120).includes('"SK":"METADATA"')) continue;
      const u = JSON.parse(line) as { id: string; firstName?: string; lastName?: string; workizName?: string };
      const own = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
      bitcrmNames.set(u.id, own);
      lookups.users.set(u.id, u.workizName || own);
    }
  }
  return { rows, deals: rows.map(toStatsDeal), workizIdOf, lookups, bitcrmNames };
}

/* ------------------------------------------------------------------ print */

function table(header: string[], body: Cell[][]): void {
  const cells = body.map((r) => r.map(String));
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(' | ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  for (const r of cells) console.log(line(r));
  console.log('');
}

const pct = (v: number): string => `${v}%`;
const totalsCells = (t: JobStatisticsTotals): Cell[] => [
  t.all,
  t.done,
  t.open,
  t.canceled,
  pct(t.canceledPct),
  money(t.gross),
  money(t.profit),
  t.laborCost === undefined ? '—' : money(t.laborCost),
  t.techExpenses === undefined ? '—' : money(t.techExpenses),
  money(t.avgSale),
  money(t.avgProfit),
];

/** Workiz's Totals row of a tab, in the same columns. */
function workizTotals(t: Cell[], tech: boolean, area: boolean): Cell[] {
  const v = area && t.length === 10 ? t.slice(1) : t;
  return tech
    ? [n(v[0]), n(v[1]), n(v[2]), n(v[3]), String(v[4]), money(n(v[5])), money(n(v[6])), money(n(v[7])), money(n(v[8])), money(n(v[9])), money(n(v[10]))]
    : [n(v[0]), n(v[1]), n(v[2]), n(v[3]), String(v[4]), money(n(v[5])), money(n(v[6])), '—', '—', money(n(v[7])), money(n(v[8]))];
}

/** Our rows beside Workiz's, matched by printed name; only the ones that differ. */
function rowDiffs(name: string, ours: JobStatisticsRow[], theirs: Cell[][], labelOf: (w: Cell[]) => string, first: number): void {
  const mine = new Map(ours.map((r) => [norm(r.label), r]));
  const wz = new Map(theirs.map((w) => [norm(labelOf(w)), w]));
  const out: Cell[][] = [];
  for (const [key, w] of wz) {
    const r = mine.get(key);
    const vals = [n(w[first]), n(w[first + 1]), n(w[first + 2]), n(w[first + 3])];
    const gross = n(w[first + 5]);
    if (!r) {
      out.push([labelOf(w).trim() || '(blank)', 'Workiz only', vals.join('/'), money(gross), '']);
      continue;
    }
    const same =
      r.all === vals[0] &&
      r.done === vals[1] &&
      r.open === vals[2] &&
      r.canceled === vals[3] &&
      Math.abs(r.canceledPct - n(w[first + 4])) < 0.006 &&
      Math.abs((r.gross ?? 0) - gross) < 0.005;
    if (!same) out.push([r.label || '(blank)', `${r.all}/${r.done}/${r.open}/${r.canceled}`, vals.join('/'), money(r.gross), money(gross)]);
  }
  for (const [key, r] of mine) if (!wz.has(key)) out.push([r.label || '(blank)', `${r.all}/${r.done}/${r.open}/${r.canceled}`, 'BitCRM only', money(r.gross), '']);
  console.log(`${name}: ${ours.length} rows (Workiz ${theirs.length}), ${out.length ? `${out.length} differ` : 'every row the same'}`);
  if (out.length) table(['Row', 'BitCRM all/done/open/canc', 'Workiz', 'BitCRM gross', 'Workiz gross'], out);
}

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const dir = arg('package');
  if (!dir) throw new Error('--package <dir> is required');
  const usersDir = arg('users') ?? join(dirname(dir.replace(/\/$/, '')), 'users');
  const from = arg('from') ?? '2026-09-01';
  const to = arg('to') ?? '2026-09-27';
  const capture = arg('workiz') ? (JSON.parse(readFileSync(arg('workiz')!, 'utf8')) as { captured?: string; responses: Record<string, { json: any }> }) : undefined;
  const jobsCapture = arg('workiz-jobs')
    ? (JSON.parse(readFileSync(arg('workiz-jobs')!, 'utf8')) as { captured?: string; by: Record<string, { rows: Array<Record<string, string | null>> }> })
    : undefined;

  const pkg = await readPackage(dir, usersDir, from, to);
  console.log(`Package: ${dir}\n  ${pkg.rows.length} active jobs near the period, ${pkg.lookups.sources.size} sources, ${pkg.lookups.users.size} users`);
  console.log(`Period: ${from}..${to} (America/New_York, inclusive)`);
  if (capture) console.log(`Workiz Job Statistics: ${arg('workiz')} (${capture.captured ?? '?'})`);
  if (jobsCapture) console.log(`Workiz Jobs report rows: ${arg('workiz-jobs')} (${jobsCapture.captured ?? '?'})`);
  console.log('');

  const opts = { money: true, profit: true, tabs: JOB_STATISTICS_TABS };
  const stats = {} as Record<JobStatisticsBy, ReturnType<typeof aggregateJobStatistics>>;
  const kept = {} as Record<JobStatisticsBy, StatsDeal[]>;
  for (const by of ['created', 'scheduled', 'end'] as JobStatisticsBy[]) {
    kept[by] = pkg.deals.filter((d) => isReportable(d) && inWindow(d, by, from, to));
    stats[by] = aggregateJobStatistics(kept[by], { by, from, to }, pkg.lookups, opts);
  }
  const noProfit = pkg.deals.filter((d) => d.superStatus === 'done' && d.profitSource !== 'workiz' && inWindow(d, 'end', from, to)).length;
  if (noProfit) console.log(`! ${noProfit} Done job(s) have no Workiz commission row — offline they count no profit (the endpoint computes it).\n`);

  /* KPIs */
  const kpiRows: Cell[][] = [];
  for (const by of ['created', 'scheduled', 'end'] as JobStatisticsBy[]) {
    const k = stats[by].kpis;
    kpiRows.push([`BitCRM ${by}`, k.all, k.done, k.submitted, k.inProgress, k.pending, k.canceled, pct(k.canceledPct), money(k.gross), money(k.profit), money(k.avgSale), money(k.avgProfit), money(k.techExpenses)]);
    const w = capture?.responses[`overview_rb${REPORT_BY[by]}`]?.json;
    if (w) {
      const all = (w.data as Array<{ jobs: number }>).reduce((a, d) => a + d.jobs, 0);
      const t = capture?.responses[`tech_rb${REPORT_BY[by]}`]?.json.totals as Cell[] | undefined;
      kpiRows.push([
        `Workiz report_by=${REPORT_BY[by]}`,
        all,
        w.done_total,
        w.submitted_total,
        w.inProgress_total,
        '',
        w.canceled_total,
        '',
        money(n(w.total)),
        money(n(w.net_profit_total)),
        t ? money(n(t[9])) : '',
        t ? money(n(t[10])) : '',
        // The overview's own `tech_parts` is one job's per day (a GROUP BY artifact, like `job_ids`); the Tech tab's Totals are the sum.
        t ? money(n(t[8])) : '',
      ]);
    }
  }
  console.log('Jobs overview — KPIs (Workiz Avg Sale / Profit and Tech exp. from its Tech tab Totals)');
  table(['', 'All', 'Done', 'Submitted', 'In progress', 'Pending', 'Canceled', 'Canc. %', 'Total Sales', 'Total Profit', 'Avg Sale', 'Avg Profit', 'Tech exp.'], kpiRows);

  const end = stats.end;
  if (capture) {
    /* Day series */
    const wDays = new Map((capture.responses.overview_rb3.json.data as Array<Record<string, Cell>>).map((d) => [String(d.status_update), d]));
    const diffs: Cell[][] = [];
    for (const d of end.series) {
      const w = wDays.get(`${d.date.slice(5, 7)}/${d.date.slice(8, 10)}/${d.date.slice(0, 4)}`);
      if (!w) continue;
      if (d.jobs !== n(w.jobs) || d.canceled !== n(w.Canceled) || Math.abs((d.sales ?? 0) - n(w.total)) > 0.005 || Math.abs((d.profit ?? 0) - n(w.net_profit)) > 0.05) {
        diffs.push([d.date, `${d.jobs} / ${n(w.jobs)}`, `${d.canceled} / ${n(w.Canceled)}`, `${money(d.sales)} / ${money(n(w.total))}`, `${money(d.profit)} / ${money(n(w.net_profit))}`]);
      }
    }
    console.log(`Day series (Closed): ${end.series.length} days, ${diffs.length} differ (profit within 5¢ counts as the same — Workiz sums unrounded shares)`);
    if (diffs.length) table(['Day', 'Jobs B/W', 'Canceled B/W', 'Sales B/W', 'Profit B/W'], diffs);

    /* Tab totals */
    const tabs: [string, JobStatisticsTable | undefined, string, boolean, boolean][] = [
      ['Sources (all)', end.sources, 'sources_rb3', false, false],
      ['Tech', end.tech, 'tech_rb3', true, false],
      ['Area (metro)', end.area?.metro, 'areas_metro_rb3', false, true],
      ['Area (city)', end.area?.city, 'areas_city_rb3', false, true],
      ['Area (zip)', end.area?.zip, 'areas_zip_rb3', false, true],
      ['Dispatcher', end.dispatcher, 'dispatch_rb3', false, false],
    ];
    const totalRows: Cell[][] = [];
    for (const [name, t, key, tech, area] of tabs) {
      if (!t) continue;
      const w = capture.responses[key]?.json;
      totalRows.push([`BitCRM ${name}`, ...totalsCells(t.totals), t.rows.length]);
      if (w) totalRows.push([`Workiz ${name}`, ...workizTotals(w.totals, tech, area), w.table_data.length]);
    }
    console.log('Tab Totals (Closed)');
    table(['', 'All', 'Done', 'Open', 'Canceled', 'Canc. %', 'Gross', 'Profit', 'Labor', 'Tech exp.', 'Avg Sale', 'Avg Profit', 'Rows'], totalRows);

    const sch = stats.scheduled;
    const rb2: [string, JobStatisticsTable | undefined, string, boolean, boolean][] = [
      ['Sources', sch.sources, 'sources_rb2', false, false],
      ['Tech', sch.tech, 'tech_rb2', true, false],
      ['Area (metro)', sch.area?.metro, 'areas_metro_rb2', false, true],
      ['Dispatcher', sch.dispatcher, 'dispatch_rb2', false, false],
    ];
    const schRows: Cell[][] = [];
    for (const [name, t, key, tech, area] of rb2) {
      const w = capture.responses[key]?.json;
      if (!t || !w) continue;
      schRows.push([`BitCRM ${name}`, ...totalsCells(t.totals), t.rows.length]);
      schRows.push([`Workiz ${name}`, ...workizTotals(w.totals, tech, area), w.table_data.length]);
    }
    console.log('Tab Totals (Scheduled)');
    table(['', 'All', 'Done', 'Open', 'Canceled', 'Canc. %', 'Gross', 'Profit', 'Labor', 'Tech exp.', 'Avg Sale', 'Avg Profit', 'Rows'], schRows);
    const ext = end.sources!.rows.filter((r) => r.kind === 'external');
    console.log(
      `Sources split: ad groups ${end.sources!.rows.filter((r) => r.kind === 'ad').reduce((a, r) => a + r.all, 0)} jobs, external companies ${ext.reduce((a, r) => a + r.all, 0)} jobs in ${ext.length} rows` +
        ` (Workiz Only Ad ${capture.responses.sources_my_rb3?.json.totals[0]}, Only referrals ${capture.responses.sources_ext_rb3?.json.totals[0]} in ${capture.responses.sources_ext_rb3?.json.table_data.length} rows)\n`,
    );

    /* The Area table */
    const wMetro = new Map((capture.responses.areas_metro_rb3.json.table_data as Cell[][]).map((w) => [norm(String(w[2])), w]));
    console.log('Area (metro), Closed — BitCRM / Workiz');
    table(
      ['Service Area', 'All', 'Done', 'Open', 'Canceled', 'Canc. %', 'Gross', 'Profit'],
      [...end.area!.metro.rows]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((r) => {
          const w = wMetro.get(norm(r.label));
          const two = (ours: Cell, theirs: Cell | undefined) =>
            theirs === undefined || String(ours) === String(theirs) || n(ours) === n(theirs) ? String(ours) : `${ours} / ${theirs}`;
          return [
            r.label,
            two(r.all, w && n(w[3])),
            two(r.done, w && n(w[4])),
            two(r.open, w && n(w[5])),
            two(r.canceled, w && n(w[6])),
            two(pct(r.canceledPct), w && String(w[7])),
            two(money(r.gross), w && money(n(w[8]))),
            two(money(r.profit), w && money(n(w[9]))),
          ];
        }),
    );
    console.log(`(a job without a service area is in no Area row: ${end.area!.withoutArea} here)\n`);

    /* Rows that differ, tab by tab */
    rowDiffs('Sources', end.sources!.rows, capture.responses.sources_rb3.json.table_data, (w) => String(w[0]), 1);
    rowDiffs('Tech', end.tech!.rows.map((r) => (r.key === 'unassigned' ? { ...r, label: 'unassigned' } : r)), capture.responses.tech_rb3.json.table_data, (w) => String(w[0]), 1);
    rowDiffs('Area (metro)', end.area!.metro.rows, capture.responses.areas_metro_rb3.json.table_data, (w) => String(w[2]), 3);
    rowDiffs('Area (city)', end.area!.city.rows, capture.responses.areas_city_rb3.json.table_data, (w) => String(w[1]), 3);
    rowDiffs('Area (zip)', end.area!.zip.rows, capture.responses.areas_zip_rb3.json.table_data, (w) => String(w[0]), 3);
    rowDiffs('Dispatcher', end.dispatcher!.rows, capture.responses.dispatch_rb3.json.table_data, (w) => String(w[0]), 1);
    console.log(
      `Dispatcher Open: BitCRM ${end.dispatcher!.totals.open} = All − Done − Canceled; Workiz ${n(capture.responses.dispatch_rb3.json.totals[2])} — ` +
        'its Dispatcher tab counts open jobs the other tabs do not (a Workiz anomaly, docs/reports/job-statistics.md).\n',
    );
  }

  /* Which jobs make the difference */
  if (jobsCapture) {
    for (const by of ['end', 'created'] as JobStatisticsBy[]) {
      const rows = jobsCapture.by[JOBS_KEY[by]]?.rows ?? [];
      const theirs = new Map(rows.map((r) => [String(r.id), r]));
      const ours = new Map(kept[by].map((d) => [pkg.workizIdOf.get(d.id) ?? `bitcrm:${d.id}`, d]));
      const byWorkizId = new Map(pkg.deals.map((d) => [pkg.workizIdOf.get(d.id) ?? `bitcrm:${d.id}`, d]));
      const notes: Cell[][] = [];
      for (const [id, r] of theirs) {
        const d = ours.get(id);
        if (!d) {
          const elsewhere = byWorkizId.get(id);
          notes.push([id, `Workiz ${r.status}, ${r[JOBS_KEY[by]]}`, elsewhere ? `${elsewhere.superStatus} on ${dayOfReport(elsewhere, by)} — moved out after the capture` : 'not in the package']);
          continue;
        }
        const st = STATUS[String(r.status)] ?? r.status;
        if (st !== d.superStatus || Math.abs(n(r.job_total_price ?? '0') - d.total) > 0.005) {
          notes.push([id, `Workiz ${r.status} ${r.job_total_price}`, `${d.superStatus} ${d.total.toFixed(2)} — changed after the capture`]);
        }
      }
      for (const [id, d] of ours) {
        if (!theirs.has(id)) notes.push([id, 'not in the capture', `${d.superStatus} ${d.total.toFixed(2)}, ${by} ${dayOfReport(d, by)}, created ${d.created}`]);
      }
      console.log(`By ${by}: ${notes.length ? `${notes.length} job(s) differ from Workiz's rows of the same evening` : 'the same jobs as Workiz, row for row'}`);
      if (notes.length) table(['Workiz job', 'Workiz', 'BitCRM package'], notes);
    }
    const dup = jobsCapture.by.job_end_date.rows.find((r) => String(r.id) === '64278193');
    if (dup && capture) {
      const gap = Math.round((n(capture.responses.overview_rb3.json.total) - (end.kpis.gross ?? 0)) * 100) / 100;
      console.log(`Workiz Total Sales − BitCRM = ${money(gap)}; job 64278193 (${dup.group_name}) is ${dup.job_total_price} — Workiz counts it twice (Sources: Denison).\n`);
    }
  }

  /* The same period through the endpoint's own path */
  if (process.argv.includes('--service')) {
    const indexes = new InMemoryReportIndexes(pkg.rows);
    const repository = new DealsRepository(indexes.dynamoDb as never);
    const users = [...pkg.bitcrmNames].map(([id, name]) => ({ id, firstName: name, lastName: '' }));
    const catalog = (list: unknown[]) => ({ list: async () => list });
    const jobsReport = new JobsReportService(
      repository,
      { get: async () => JOBS_REPORT_DEFAULT_SETTINGS, put: async () => undefined } as never,
      { getUserNamesBatch: async (ids: string[]) => users.filter((u) => ids.includes(u.id)), getContactNames: async () => [], getContactsAsCaller: async () => [] } as never,
      catalog([...pkg.lookups.jobTypes].map(([id, name]) => ({ id, name }))) as never,
      catalog([...pkg.lookups.sources].map(([id, s]) => ({ id, ...s }))) as never,
      catalog([]) as never,
      catalog([]) as never,
      catalog([...pkg.lookups.serviceAreas].map(([id, name]) => ({ id, name }))) as never,
      catalog([...pkg.lookups.externalCompanies].map(([id, name]) => ({ id, name }))) as never,
    );
    const service = new JobStatisticsService(repository, jobsReport, { build: async () => ({ rows: [], warnings: [] }) } as never);
    const perms = { roleId: 'x', roleName: 'Super Admin', isSystemRole: true, permissions: {}, dataScope: {} } as unknown as ResolvedPermissions;
    const res: JobStatistics = await service.statistics({ by: 'end', from, to } as JobsReportQueryDto, {
      user: { id: 'verify', cognitoSub: '', email: '', roleId: 'x', department: '' },
      perms,
    });
    const same = (a: JobStatisticsTotals | undefined, b: JobStatisticsTotals | undefined) => JSON.stringify(a) === JSON.stringify(b);
    const checks: [string, boolean][] = [
      ['KPIs', same(res.kpis, end.kpis)],
      ['series', JSON.stringify(res.series) === JSON.stringify(end.series)],
      ['Sources', same(res.sources?.totals, end.sources?.totals) && res.sources?.rows.length === end.sources?.rows.length],
      ['Tech', same(res.tech?.totals, end.tech?.totals) && res.tech?.rows.length === end.tech?.rows.length],
      ['Area', same(res.area?.metro.totals, end.area?.metro.totals) && res.area?.zip.rows.length === end.area?.zip.rows.length],
      ['Dispatcher', same(res.dispatcher?.totals, end.dispatcher?.totals)],
    ];
    console.log(
      `Through the endpoint (JobStatisticsService → DealsRepository.readReportWindow → EndIndex in memory, ${indexes.queries} index queries): ` +
        checks.map(([k, ok]) => `${k} ${ok ? 'same' : 'DIFFERENT'}`).join(', '),
    );
  }
}

main().catch((err) => {
  console.error('verify-job-statistics failed:', err);
  process.exit(1);
});
