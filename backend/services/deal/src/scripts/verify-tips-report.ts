/**
 * Check the Tips report against Workiz — offline, read-only.
 *
 * WHY
 * ---
 * The report must give the numbers Workiz gives for the same period. Workiz
 * was read live on 2026-09-30 (`workiz-data-parser/docs/reports/tips.md`,
 * «Перевірочні числа»; the capture is `live_verification_2026-09-30.json`,
 * every person's line AND every person's jobs, 01–27.09 and 01–30.09):
 *
 *   01–27.09   56 people   Σ Tip total 2 899.77   Σ Jobs 2 376
 *
 * This runs the report's own code (`tips-report.logic.ts`) over the deal rows
 * of a Workiz import package — the very items the importer writes to
 * DynamoDB — and prints, person by person, Workiz / BitCRM / difference. With
 * the capture it also names every job that differs and on which side: a job
 * edited in Workiz after the package was pulled (canceled, moved, reassigned,
 * deleted) is on one side only.
 *
 * People are matched through the users of the package (`externalId`
 * `workiz:user:<id>`), jobs through the deals' `workizId`.
 *
 * Nothing is written anywhere; the package is only read.
 *
 * USAGE
 * -----
 *   npm run verify:tips-report -w backend/services/deal -- \
 *     --package <package dir: deals/ and users/> --workiz <capture.json> [--period 1.9.26_27.9.26] [--service]
 *
 * `--service` runs the period once more through the endpoint's own path —
 * `TipsReportService.page()` over a real `DealsRepository` whose DynamoDB is
 * the report indexes in memory (`jobs-report-in-memory.ts`) — and says
 * whether every line is the same as the logic's.
 */
import { createReadStream, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import type { ResolvedPermissions } from '@bitcrm/types';
import { DealsRepository } from '../deals/deals.repository';
import { JobsReportService } from '../deals/report/jobs-report.service';
import { TipsReportService } from '../deals/report/tips-report.service';
import type { TipsReportQueryDto } from '../deals/report/tips-report.query';
import { TIPS_PROJECTION, keptJobs, shareToDollars, tipsByTech, toTipsDeal, type TipsDeal } from '../deals/report/tips-report.logic';
import { shiftDay } from '../deals/report/report-dates';
import { InMemoryReportIndexes } from './jobs-report-in-memory';

interface WorkizLine {
  id: string;
  name: string;
  total_tips: string;
  total_jobs: string;
}
/** `[job_id, job_uuid, job_date, total_amount, total_tip]` — one person's job. */
type WorkizJob = [string, string, string, string, string];
interface Capture {
  captured?: Record<string, string>;
  periods: Record<string, { rows: WorkizLine[]; jobs?: Record<string, WorkizJob[]> }>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** `1.9.26_27.9.26` → `2026-09-01`, `2026-09-27`. */
function period(q: string): { from: string; to: string } {
  const day = (s: string) => {
    const [d, m, y] = s.split('.').map(Number);
    return `${2000 + y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const [a, b] = q.split('_');
  return { from: day(a), to: day(b) };
}

async function* lines(dir: string): AsyncGenerator<string> {
  if (!existsSync(dir)) return;
  for (const part of readdirSync(dir).filter((f) => /^part-.*\.jsonl$/.test(f)).sort()) {
    yield* createInterface({ input: createReadStream(join(dir, part)), crlfDelay: Infinity });
  }
}

/** The package's active deals (as the window would read them) and who is who in Workiz. */
async function readPackage(dir: string, from: string, to: string) {
  const deals: TipsDeal[] = [];
  const rows: Record<string, unknown>[] = [];
  const workizIdOf = new Map<string, string>();
  const lo = shiftDay(from, -45);
  const hi = shiftDay(to, 45);
  for await (const line of lines(join(dir, 'deals'))) {
    if (!line.startsWith('{"PK":"DEAL#') || !line.slice(0, 160).includes('"SK":"METADATA"')) continue;
    const item = JSON.parse(line) as Record<string, unknown>;
    if (item.SK !== 'METADATA' || item.status !== 'active') continue;
    const near = ['scheduledDate', 'jobDateUtc'].some((k) => {
      const v = typeof item[k] === 'string' ? (item[k] as string).slice(0, 10) : '';
      return v >= lo && v <= hi;
    });
    if (!near) continue;
    const d = toTipsDeal(item);
    deals.push(d);
    if (item.workizId !== undefined) workizIdOf.set(d.id, String(item.workizId));
    rows.push(Object.fromEntries([...TIPS_PROJECTION, 'workizId'].filter((k) => item[k] !== undefined).map((k) => [k, item[k]])));
  }
  const workizUser = new Map<string, string>();
  const userName = new Map<string, string>();
  for await (const line of lines(join(dir, 'users'))) {
    if (!line.includes('"SK":"METADATA"')) continue;
    const u = JSON.parse(line) as Record<string, unknown>;
    if (u.SK !== 'METADATA') continue;
    const ext = String(u.externalId ?? '');
    if (ext.startsWith('workiz:user:')) workizUser.set(String(u.id), ext.slice('workiz:user:'.length));
    userName.set(String(u.id), `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim());
  }
  return { deals, rows, workizIdOf, workizUser, userName };
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (s: string | number) => Math.round(Number(s) * 100);

async function main(): Promise<void> {
  const dir = arg('package');
  const capturePath = arg('workiz');
  if (!dir || !capturePath) throw new Error('--package <dir> and --workiz <capture.json> are required');
  const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as Capture;
  const key = arg('period') ?? '1.9.26_27.9.26';
  const wz = capture.periods[key];
  if (!wz) throw new Error(`No period ${key} in the capture (${Object.keys(capture.periods).join(', ')})`);
  const { from, to } = period(key);

  const pkg = await readPackage(dir, from, to);
  console.log(`Package: ${dir} — ${pkg.deals.length} active jobs near the period, ${pkg.workizUser.size} Workiz users`);
  console.log(`Workiz: ${capturePath} (${JSON.stringify(capture.captured ?? {})}), period ${key} = ${from}..${to}\n`);

  const jobs = keptJobs(pkg.deals, from, to, {});
  const ours = new Map(tipsByTech(jobs, {}).map((t) => [pkg.workizUser.get(t.techId) ?? `bitcrm:${t.techId}`, t]));
  const theirs = new Map(wz.rows.map((r) => [r.id, r]));

  // Person by person.
  const table: string[][] = [];
  let sumW = 0;
  let sumB = 0;
  let jobsW = 0;
  let jobsB = 0;
  const ids = [...new Set([...theirs.keys(), ...ours.keys()])].sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const w = theirs.get(id);
    const b = ours.get(id);
    const tw = w ? cents(w.total_tips) : 0;
    const tb = b ? Math.round(shareToDollars(b.tipCents) * 100) : 0;
    const jw = w ? Number(w.total_jobs) : 0;
    const jb = b?.jobs ?? 0;
    sumW += tw;
    sumB += tb;
    jobsW += jw;
    jobsB += jb;
    const name = w?.name ?? (b ? pkg.userName.get(b.techId) ?? b.techId : id);
    const diff = [tb - tw ? `tips ${money((tb - tw) / 100)}` : '', jb - jw ? `jobs ${jb - jw > 0 ? '+' : ''}${jb - jw}` : ''].filter(Boolean).join(', ');
    table.push([name, money(tw / 100), String(jw), money(tb / 100), String(jb), diff || '0']);
  }
  table.push(['TOTAL', money(sumW / 100), String(jobsW), money(sumB / 100), String(jobsB), [sumB - sumW ? `tips ${money((sumB - sumW) / 100)}` : '', jobsB - jobsW ? `jobs ${jobsB - jobsW}` : ''].filter(Boolean).join(', ') || '0']);
  const header = ['Tech', 'Workiz tips', 'Workiz jobs', 'BitCRM tips', 'BitCRM jobs', 'Difference'];
  const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 || i === 5 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(' | ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  for (const r of table) console.log(line(r));
  console.log(`\n${table.filter((r) => r[5] === '0').length - 1} of ${table.length - 1} people identical; ${theirs.size} lines in Workiz, ${ours.size} here.\n`);

  // Job by job: who is on which side.
  if (wz.jobs) {
    const byWorkiz = new Map(jobs.map((d) => [pkg.workizIdOf.get(d.id) ?? `bitcrm:${d.id}`, d]));
    const allDeals = new Map(pkg.deals.map((d) => [pkg.workizIdOf.get(d.id) ?? `bitcrm:${d.id}`, d]));
    const pairsW = new Map<string, WorkizJob>();
    for (const [tech, list] of Object.entries(wz.jobs)) for (const j of list) pairsW.set(`${tech}|${j[0]}`, j);
    const pairsB = new Set<string>();
    for (const [wid, d] of byWorkiz) for (const t of new Set(d.techIds)) pairsB.add(`${pkg.workizUser.get(t) ?? t}|${wid}`);
    const notes: string[] = [];
    for (const [k, j] of pairsW) {
      const [tech, wid] = k.split('|');
      if (pairsB.has(k)) {
        const d = byWorkiz.get(wid)!;
        const share = shareToDollars(d.tipCents / new Set(d.techIds).size);
        if (cents(j[4]) !== Math.round(share * 100)) notes.push(`  ≠ ${wid} tech ${tech}: tip ${j[4]} in Workiz, ${share} here`);
        continue;
      }
      const d = allDeals.get(wid);
      notes.push(
        d
          ? `  − ${wid} ${j[1]} tech ${tech} (Workiz job date ${j[2]}): here on ${d.scheduled ?? '—'}, ${d.superStatus}, people ${[...d.techIds].map((t) => pkg.workizUser.get(t) ?? t).join(',') || 'none'}`
          : `  − ${wid} ${j[1]} tech ${tech} (Workiz job date ${j[2]}, total ${j[3]}): not in the package`,
      );
    }
    for (const k of pairsB) {
      if (pairsW.has(k)) continue;
      const [tech, wid] = k.split('|');
      const d = byWorkiz.get(wid)!;
      notes.push(`  + ${wid} ${d.jobNumber} tech ${tech}: here on ${d.scheduled}, ${d.superStatus} — not in Workiz's list for this person`);
    }
    console.log(`Jobs: ${pairsW.size} person-job pairs in Workiz, ${pairsB.size} here — ${notes.length ? `${notes.length} differences:` : 'identical'}`);
    for (const n of notes.sort()) console.log(n);
    console.log('');
  }

  if (process.argv.includes('--service')) {
    const indexes = new InMemoryReportIndexes(pkg.rows);
    const repository = new DealsRepository(indexes.dynamoDb as never);
    const catalog = { list: async () => [] };
    const jobsReport = new JobsReportService(
      repository,
      { get: async () => undefined } as never,
      { getUserNamesBatch: async () => [], getContactNames: async () => [], getContactsAsCaller: async () => [] } as never,
      catalog as never,
      catalog as never,
      catalog as never,
      catalog as never,
      catalog as never,
      catalog as never,
    );
    const service = new TipsReportService(repository, jobsReport);
    const perms = { roleId: 'x', roleName: 'Super Admin', isSystemRole: true, permissions: {}, dataScope: {} } as unknown as ResolvedPermissions;
    const page = await service.page({ from, to } as TipsReportQueryDto, {
      user: { id: 'verify', cognitoSub: '', email: '', roleId: 'x', department: '' } as never,
      perms,
    });
    const same =
      page.rows.length === ours.size &&
      page.rows.every((r) => {
        const t = ours.get(pkg.workizUser.get(r.techId) ?? `bitcrm:${r.techId}`);
        return t && t.jobs === r.jobs && Math.round(shareToDollars(t.tipCents) * 100) === Math.round((r.tips ?? 0) * 100);
      });
    const tips = page.rows.reduce((a, r) => a + Math.round((r.tips ?? 0) * 100), 0);
    console.log(
      `Through the endpoint (TipsReportService.page → DealsRepository.readReportWindow → indexes in memory): ${page.rows.length} people, ` +
        `Σ ${money(tips / 100)}, Σ jobs ${page.rows.reduce((a, r) => a + r.jobs, 0)} — ${same ? 'the same lines as the logic' : 'DIFFERENT lines'} (${indexes.queries} index queries)`,
    );
  }
}

main().catch((err) => {
  console.error('verify-tips-report failed:', err);
  process.exit(1);
});
