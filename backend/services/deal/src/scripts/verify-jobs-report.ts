/**
 * Check the Jobs report against Workiz — offline, read-only.
 *
 * WHY
 * ---
 * The report must give the numbers Workiz gives for the same period. Workiz
 * was read live on 2026-09-29 (~22:10 Asia/Jerusalem) for 2026-09-01..27
 * (`workiz-data-parser/docs/reports/jobs.md`, «Перевірочні числа»):
 *
 *   By Job created  3 595 rows
 *   By Job date     3 496 rows   Σ Total 660 527.13   Done 1 073, Σ 660 283.62
 *   By Job end date 3 498 rows   Σ Total 660 527.13   Done 1 073, Σ 660 283.62
 *
 * This runs the report's own code (`jobs-report.logic.ts`: the window on the
 * account's calendar, the rows, the money) over the deal rows of a Workiz
 * import package — the very items the importer writes to DynamoDB — and
 * prints the same figures. Given Workiz's per-row capture
 * (`live_verification_2026-09-01_27.json`) it also names every job that
 * differs and why: a job edited in Workiz after the capture (closed, moved,
 * re-priced, deleted) is on one side only, or on both with other values.
 *
 * Nothing is written anywhere; the package is only read.
 *
 * USAGE
 * -----
 *   npm run verify:jobs-report -w backend/services/deal -- \
 *     --package <dir with part-*.jsonl> [--from 2026-09-01 --to 2026-09-27] [--workiz <capture.json>]
 */
import { createReadStream, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import type { JobsReportBy } from '@bitcrm/types';
import { dayOfReport, toReportDeal, type ReportDeal } from '../deals/report/jobs-report.logic';
import { summarizeJobsReport } from '../deals/report/jobs-report.summary';

const WORKIZ_KEY: Record<JobsReportBy, string> = { created: 'created', scheduled: 'job_date', end: 'job_end_date' };
const WORKIZ_STATUS: Record<string, string> = {
  Submitted: 'submitted',
  'In progress': 'in_progress',
  Done: 'done',
  Pending: 'pending',
  'done pending approval': 'done_pending_approval',
  Canceled: 'canceled',
};

interface WorkizRow {
  id: string;
  status: string;
  job_total_price: string;
  job_amount_due?: string;
  created: string;
  job_date: string;
  job_end_date: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function readPackage(dir: string): Promise<{ deals: ReportDeal[]; workizIdOf: Map<string, string>; deleted: number }> {
  const deals: ReportDeal[] = [];
  const workizIdOf = new Map<string, string>();
  let deleted = 0;
  const parts = readdirSync(dir).filter((f) => /^part-.*\.jsonl$/.test(f)).sort();
  if (!parts.length) throw new Error(`No part-*.jsonl in ${dir}`);
  for (const part of parts) {
    const lines = createInterface({ input: createReadStream(join(dir, part)), crlfDelay: Infinity });
    for await (const line of lines) {
      // Deal METADATA rows only; the package also holds catalogs, assignments, lines.
      if (!line.startsWith('{"PK":"DEAL#') || !line.slice(0, 160).includes('"SK":"METADATA"')) continue;
      const item = JSON.parse(line) as Record<string, unknown>;
      if (item.SK !== 'METADATA') continue;
      if (item.status !== 'active') {
        deleted += 1;
        continue;
      }
      const d = toReportDeal(item);
      deals.push(d);
      if (item.workizId !== undefined) workizIdOf.set(d.id, String(item.workizId));
    }
  }
  return { deals, workizIdOf, deleted };
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main(): Promise<void> {
  const dir = arg('package');
  if (!dir) throw new Error('--package <dir> is required');
  const from = arg('from') ?? '2026-09-01';
  const to = arg('to') ?? '2026-09-27';
  const workizPath = arg('workiz');

  const { deals, workizIdOf, deleted } = await readPackage(dir);
  console.log(`Package: ${dir}\n  ${deals.length} active jobs (${deleted} not active)\nPeriod: ${from}..${to} (America/New_York, inclusive)\n`);

  const workiz = workizPath
    ? (JSON.parse(readFileSync(workizPath, 'utf8')) as { captured?: string; by: Record<string, { rows: WorkizRow[] }> })
    : undefined;
  if (workiz) console.log(`Workiz capture: ${workizPath} (${workiz.captured ?? '?'})\n`);

  const byWorkizId = new Map<string, ReportDeal>();
  for (const d of deals) {
    const w = workizIdOf.get(d.id);
    if (w) byWorkizId.set(w, d);
  }

  const header = ['By', 'Rows', 'Σ Total', 'Σ Total Done', 'Σ Amount due', 'Done', 'Canceled', 'Pending', 'Submitted', 'In progress', 'Lead'];
  const table: string[][] = [];
  for (const by of ['created', 'scheduled', 'end'] as JobsReportBy[]) {
    const s = summarizeJobsReport(deals, by, from, to);
    table.push([
      `BitCRM ${by}`,
      String(s.rows),
      money(s.total),
      money(s.doneTotal),
      money(s.amountDue),
      String(s.byStatus.done),
      String(s.byStatus.canceled),
      String(s.byStatus.pending),
      String(s.byStatus.submitted),
      String(s.byStatus.in_progress),
      String(s.origin.lead),
    ]);
    const rows = workiz?.by[WORKIZ_KEY[by]]?.rows;
    if (!rows) continue;

    const count = (st: string) => rows.filter((r) => r.status === st).length;
    const sum = (list: WorkizRow[], pick: (r: WorkizRow) => string | undefined) =>
      list.reduce((a, r) => a + Math.round(Number(pick(r) ?? 0) * 100), 0) / 100;
    table.push([
      `Workiz ${WORKIZ_KEY[by]}`,
      String(rows.length),
      money(sum(rows, (r) => r.job_total_price)),
      money(sum(rows.filter((r) => r.status === 'Done'), (r) => r.job_total_price)),
      money(sum(rows, (r) => r.job_amount_due)),
      String(count('Done')),
      String(count('Canceled')),
      String(count('Pending')),
      String(count('Submitted')),
      String(count('In progress')),
      '',
    ]);

    // Row by row: who is on one side only, and who differs.
    const ours = new Set(s.ids.map((id) => workizIdOf.get(id) ?? `bitcrm:${id}`));
    const theirs = new Map(rows.map((r) => [r.id, r]));
    const notes: string[] = [];
    for (const [id, r] of theirs) {
      if (ours.has(id)) {
        const d = byWorkizId.get(id)!;
        const st = WORKIZ_STATUS[r.status] ?? r.status;
        const diffs: string[] = [];
        if (st !== d.superStatus) diffs.push(`status ${r.status} → ${d.superStatus}`);
        if (Math.abs(Number(r.job_total_price) - d.total) > 0.005) diffs.push(`total ${r.job_total_price} → ${d.total.toFixed(2)}`);
        if (diffs.length) notes.push(`  ≠ ${id}: ${diffs.join(', ')}`);
        continue;
      }
      const d = byWorkizId.get(id);
      notes.push(
        d
          ? `  − ${id} (Workiz ${r.status}, ${r[WORKIZ_KEY[by] as keyof WorkizRow]}): in the package on ${dayOfReport(d, by)} as ${d.superStatus} — moved after the capture`
          : `  − ${id} (Workiz ${r.status}, ${r.job_total_price}): not in the package`,
      );
    }
    for (const id of ours) {
      if (theirs.has(id)) continue;
      const d = byWorkizId.get(id);
      notes.push(`  + ${id}: ${d ? `${d.superStatus}, ${by} ${dayOfReport(d, by)}, created ${d.created}, total ${d.total.toFixed(2)}` : 'native'} — not in the capture`);
    }
    console.log(`By ${by}: ${notes.length ? `${notes.length} differences` : 'identical to Workiz, row for row'}`);
    for (const n of notes) console.log(n);
    console.log('');
  }

  const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(' | ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  for (const r of table) console.log(line(r));
}

main().catch((err) => {
  console.error('verify-jobs-report failed:', err);
  process.exit(1);
});
