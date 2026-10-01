/**
 * Check the Sales report against Workiz — offline, read-only.
 *
 * WHY
 * ---
 * The report must give the numbers Workiz gives for the same period and
 * filters. Workiz was read live on 2026-09-30 17:22–17:24 UTC
 * (`workiz-data-parser/docs/reports/sales.md`, «Перевірочні числа»): the
 * Total row and every job id of each run — 01–27.09 and 01–30.09 on each
 * "By:", and 01–27.09 by technician, job type, source, area, status and
 * payment status — plus each job's money for the unfiltered runs
 * (`data/ui_reference/workiz_reports/sales/live_verification_2026-09-30.json`).
 *
 * This runs the report's own code (`sales-report.logic.ts`: which jobs are
 * sales, the window on the account's calendar, the money, the filters, the
 * Total row) over the deal rows of a Workiz import package — the very items
 * the importer writes to DynamoDB — and prints «Workiz / BitCRM / difference»
 * per run, then names every job that differs and in what.
 *
 * Workiz ids in the capture's filters become BitCRM ids the way the importer
 * makes them: uuid5 of "<namespace>:<workiz id>" (user, jobtype, adgroup,
 * metro). Runs "By: Job first payment date" are skipped — BitCRM does not
 * offer that date yet.
 *
 * Nothing is written anywhere; the package is only read.
 *
 * USAGE
 * -----
 *   npm run verify:sales-report -w backend/services/deal -- \
 *     --package <dir with part-*.jsonl> --workiz <live_verification_2026-09-30.json> [--rows] [--service]
 *
 * `--rows` lists every differing job of the unfiltered runs. `--service`
 * runs 01–27.09 "By: Job date" once more through the endpoint's own path —
 * `SalesReportService.page()` over a real `DealsRepository` whose DynamoDB is
 * the report indexes in memory (`jobs-report-in-memory.ts`) — paging 1 000
 * rows at a time, and says whether it lists the same jobs and the same Total.
 */
import { createReadStream, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { v5 as uuidv5 } from 'uuid';
import {
  JobSuperStatus,
  SALES_REPORT_DEFAULT_SETTINGS,
  type ResolvedPermissions,
  type SalesReportBy,
  type SalesReportFilters,
  type SalesReportMoney,
  type SalesReportPaymentStatus,
} from '@bitcrm/types';
import { DealsRepository } from '../deals/deals.repository';
import { JobsReportService } from '../deals/report/jobs-report.service';
import { SalesReportService } from '../deals/report/sales-report.service';
import type { SalesReportQueryDto } from '../deals/report/sales-report.query';
import { SALES_PROJECTION, salesOf, salesTotals, toSalesDeal, type SalesDeal } from '../deals/report/sales-report.logic';
import { shiftDay } from '../deals/report/report-dates';
import { InMemoryReportIndexes } from './jobs-report-in-memory';

const BITCRM_NS = uuidv5('https://bitcrm.tech-slk.com/workiz', uuidv5.URL);
const bid = (namespace: string, workizId: string | number) => uuidv5(`${namespace}:${workizId}`, BITCRM_NS);

const BY: Record<number, SalesReportBy | undefined> = { 1: 'created', 2: 'scheduled', 3: 'end' };
const STATUS: Record<string, string> = {
  Submitted: JobSuperStatus.SUBMITTED,
  'In progress': JobSuperStatus.IN_PROGRESS,
  Done: JobSuperStatus.DONE,
  Pending: JobSuperStatus.PENDING,
  'done pending approval': JobSuperStatus.DONE_PENDING_APPROVAL,
  Canceled: JobSuperStatus.CANCELED,
};
const PAYMENT: Record<string, SalesReportPaymentStatus> = { '1': 'paid', '2': 'partly_paid', '3': 'due' };

/** Workiz money keys → ours. */
const MONEY: [keyof SalesReportMoney, string][] = [
  ['total', 'total_price'],
  ['subtotal', 'sub_total'],
  ['tax', 'tax_amount'],
  ['tip', 'tip_amount'],
  ['itemCost', 'cost'],
  ['techExpenses', 'tech_parts'],
  ['laborCost', 'labour_cost'],
  ['cardExpenses', 'card_expenses'],
  ['paid', 'paid_amount'],
  ['due', 'due'],
  ['profit', 'profit'],
];

interface WorkizRun {
  date_query?: string;
  report_by?: number;
  filters?: Record<string, (string | number)[]>;
  search?: string;
  totals?: Record<string, string | number | null>;
  jobIds?: string[];
  rows?: Record<string, Record<string, string | number | null>>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** "1.9.26_27.9.26" → 2026-09-01 .. 2026-09-27. */
function period(q: string): { from: string; to: string } {
  const day = (s: string) => {
    const [d, m, y] = s.split('.').map(Number);
    return `20${String(y).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const [a, b] = q.split('_');
  return { from: day(a), to: day(b) };
}

/** A run's Workiz filters as the report's own, ids made the importer's way. */
function filtersOf(f: Record<string, (string | number)[]> = {}): SalesReportFilters {
  const out: SalesReportFilters = {};
  if (f.status?.length) out.status = f.status.map((s) => STATUS[String(s)] ?? String(s));
  if (f.user?.length) out.techId = f.user.map((id) => bid('user', id));
  if (f.type?.length) out.jobTypeId = f.type.map((id) => bid('jobtype', id));
  if (f.source?.length) out.sourceId = f.source.map((id) => bid('adgroup', id));
  if (f.metro?.length) out.serviceAreaId = f.metro.map((id) => bid('metro', id));
  if (f.payment_status?.length) out.paymentStatus = f.payment_status.map((v) => PAYMENT[String(v)]);
  return out;
}

async function readPackage(
  dir: string,
  keep?: { from: string; to: string },
): Promise<{ deals: SalesDeal[]; workizIdOf: Map<string, string>; rows: Record<string, unknown>[] }> {
  const deals: SalesDeal[] = [];
  const rows: Record<string, unknown>[] = [];
  const workizIdOf = new Map<string, string>();
  const parts = readdirSync(dir).filter((f) => /^part-.*\.jsonl$/.test(f)).sort();
  if (!parts.length) throw new Error(`No part-*.jsonl in ${dir}`);
  const lo = keep && shiftDay(keep.from, -45);
  const hi = keep && shiftDay(keep.to, 45);
  for (const part of parts) {
    const lines = createInterface({ input: createReadStream(join(dir, part)), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.startsWith('{"PK":"DEAL#') || !line.slice(0, 160).includes('"SK":"METADATA"')) continue;
      const item = JSON.parse(line) as Record<string, unknown>;
      if (item.SK !== 'METADATA' || item.status !== 'active') continue;
      const d = toSalesDeal(item);
      deals.push(d);
      if (item.workizId !== undefined) workizIdOf.set(d.id, String(item.workizId));
      if (keep && ['createdAt', 'scheduledDate', 'scheduledEndDate', 'jobDateUtc', 'jobEndDateUtc'].some((k) => {
        const v = typeof item[k] === 'string' ? (item[k] as string).slice(0, 10) : '';
        return v >= lo! && v <= hi!;
      })) {
        const projected = [...SALES_PROJECTION, 'workizId'];
        rows.push(Object.fromEntries(projected.filter((k) => item[k] !== undefined).map((k) => [k, item[k]])));
      }
    }
  }
  return { deals, workizIdOf, rows };
}

const money = (n: number | undefined) =>
  n === undefined ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => Math.round(Number(v ?? 0) * 100);

async function throughTheService(rows: Record<string, unknown>[], expectedIds: string[], expectedTotal: number): Promise<void> {
  const indexes = new InMemoryReportIndexes(rows);
  const repository = new DealsRepository(indexes.dynamoDb as never);
  const catalog = { list: async () => [] };
  const names = { getUserNamesBatch: async () => [], getContactNames: async () => [], getContactsAsCaller: async () => [] };
  const c = catalog as never;
  const jobs = new JobsReportService(repository, {} as never, names as never, c, c, c, c, c, c);
  const service = new SalesReportService(repository, { get: async () => SALES_REPORT_DEFAULT_SETTINGS } as never, jobs);
  const perms = { roleName: 'Super Admin', isSystemRole: true, permissions: {}, dataScope: {} } as unknown as ResolvedPermissions;
  const caller = { user: { id: 'verify', cognitoSub: '', email: '', roleId: 'x', department: '' }, perms };
  const ids: string[] = [];
  let total: number | undefined;
  for (let page = 1; ; page++) {
    const res = await service.page(
      { by: 'scheduled', from: '2026-09-01', to: '2026-09-27', page: String(page), pageSize: '1000' } as SalesReportQueryDto,
      caller,
    );
    ids.push(...res.rows.map((r) => r.id));
    total = res.totals.total;
    if (page >= res.pagination.pages) break;
  }
  const same = ids.length === expectedIds.length && new Set([...ids, ...expectedIds]).size === ids.length;
  console.log(
    `Through the endpoint (SalesReportService.page → readReportWindow, five status partitions → indexes in memory, ${rows.length} rows held):\n` +
      `  01–27.09 by Job date: ${ids.length} jobs, Total ${money(total)} — ${same && Math.round((total ?? 0) * 100) === expectedTotal ? 'the same jobs and Total as the report logic' : 'DIFFERENT'} ` +
      `(${indexes.queries} index queries)\n`,
  );
}

async function main(): Promise<void> {
  const dir = arg('package');
  const workizPath = arg('workiz');
  if (!dir || !workizPath) throw new Error('--package <dir> and --workiz <capture.json> are required');
  const viaService = process.argv.includes('--service');
  const listRows = process.argv.includes('--rows');

  const capture = JSON.parse(readFileSync(workizPath, 'utf8')) as { captured_utc?: string[]; runs: Record<string, WorkizRun> };
  const { deals, workizIdOf, rows } = await readPackage(dir, viaService ? { from: '2026-09-01', to: '2026-09-27' } : undefined);
  const byWorkizId = new Map<string, SalesDeal>();
  for (const d of deals) {
    const w = workizIdOf.get(d.id);
    if (w) byWorkizId.set(w, d);
  }
  console.log(`Package: ${dir} — ${deals.length} active jobs\nWorkiz capture: ${workizPath} (${(capture.captured_utc ?? []).join(' – ')})\n`);

  const header = ['Run', 'Jobs W', 'Jobs B', 'Total W', 'Total B', 'Δ Total', 'Δ Item cost', 'Δ Paid', 'Δ Due', 'Δ Profit', 'Only W', 'Only B'];
  const table: string[][] = [];
  const notes: string[] = [];
  let expected: { ids: string[]; total: number } | undefined;

  for (const [name, run] of Object.entries(capture.runs)) {
    if (!run.date_query || run.report_by === undefined || run.search) continue;
    const by = BY[run.report_by];
    if (!by) {
      table.push([name, String(run.totals?.counter ?? 0), '—', money(Number(run.totals?.total_price ?? 0)), '—', 'By first payment — not offered', '', '', '', '', '', '']);
      continue;
    }
    const { from, to } = period(run.date_query);
    const kept = salesOf(deals, by, from, to, filtersOf(run.filters));
    const t = salesTotals(kept, true);
    const w = run.totals ?? {};
    const theirs = new Set(run.jobIds ?? []);
    const ours = new Set(kept.map((d) => workizIdOf.get(d.id) ?? `bitcrm:${d.id}`));
    const onlyW = [...theirs].filter((id) => !ours.has(id));
    const onlyB = [...ours].filter((id) => !theirs.has(id));
    const delta = (ourKey: keyof SalesReportMoney, theirKey: string) => money((num(t[ourKey]) - num(w[theirKey])) / 100);
    table.push([
      name,
      String(w.counter ?? 0),
      String(t.jobs),
      money(Number(w.total_price ?? 0)),
      money(t.total),
      delta('total', 'total_price'),
      delta('itemCost', 'cost'),
      delta('paid', 'paid_amount'),
      delta('due', 'due'),
      delta('profit', 'profit'),
      String(onlyW.length),
      String(onlyB.length),
    ]);
    if (name === 's27_by2') expected = { ids: kept.map((d) => d.id), total: num(t.total) };

    // Job by job, for the runs that carry each job's money.
    if (!run.rows) continue;
    const lines: string[] = [];
    for (const id of onlyW) {
      const d = byWorkizId.get(id);
      const r = run.rows[id];
      lines.push(
        d
          ? `  − ${id}: Workiz ${r?.status} ${r?.total_price}; package ${d.superStatus} ${(d.cents.total / 100).toFixed(2)} — changed after the pull`
          : `  − ${id}: Workiz ${r?.status} ${r?.total_price}; not in the package — created after the pull`,
      );
    }
    for (const id of onlyB) {
      const d = byWorkizId.get(id);
      lines.push(`  + ${id}: package ${d?.superStatus} ${d ? (d.cents.total / 100).toFixed(2) : ''} — not in Workiz any more (moved, zeroed or canceled after the pull)`);
    }
    for (const [id, r] of Object.entries(run.rows)) {
      const d = byWorkizId.get(id);
      if (!d || !ours.has(id)) continue;
      const diffs = MONEY.filter(([ourKey, theirKey]) => d.cents[ourKey] !== num(r[theirKey])).map(
        ([ourKey, theirKey]) => `${ourKey} ${Number(r[theirKey] ?? 0).toFixed(2)} → ${(d.cents[ourKey] / 100).toFixed(2)}`,
      );
      if (diffs.length) lines.push(`  ≠ ${id} (#${r.job_serial}): Workiz → BitCRM ${diffs.join(', ')}`);
    }
    notes.push(`${name}: ${lines.length ? `${lines.length} jobs differ` : 'identical to Workiz, job for job and cent for cent'}`);
    if (listRows) notes.push(...lines);
  }

  const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(' | ');
  console.log(line(header));
  console.log(widths.map((x) => '-'.repeat(x)).join('-|-'));
  for (const r of table) console.log(line(r));
  console.log('\nW = Workiz, B = BitCRM; Δ = BitCRM − Workiz.\n');
  for (const n of notes) console.log(n);
  console.log('');

  if (viaService && expected) await throughTheService(rows, expected.ids, expected.total);
}

main().catch((err) => {
  console.error('verify-sales-report failed:', err);
  process.exit(1);
});
