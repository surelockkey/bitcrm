/**
 * Check the Timesheets report against Workiz — offline, read-only.
 *
 * WHY
 * ---
 * The report must give the numbers Workiz gives for the same period. Workiz
 * was read live on 2026-09-30 (`POST /ajaxc/clock/getTimesheetReport/`, the
 * endpoint its `/root/timesheet` page calls); the capture is
 * `workiz-data-parser/data/ui_reference/workiz_reports/timesheets/live_verification_2026-09-30.json`
 * and the spec with the check figures is `workiz-data-parser/docs/reports/timesheets.md`.
 *
 * This runs the endpoint's own path — `TimesheetReportService.report()` with
 * its query parser, the account clock and the arithmetic — over the rows a
 * Workiz import package writes to DynamoDB (group `timeclock`: `CLOCK#` items
 * with their GSI6 keys, and the `CLOCK_OPEN` slots of its conditional file),
 * held in memory behind a stand-in for `TimeClockRepository` that answers the
 * same four questions the real one asks DynamoDB (a month partition of
 * TimeClockIndex between two instants, a person's own partition, names, who
 * is clocked in). It prints, per captured case, Workiz / BitCRM / difference.
 *
 * Nothing is written anywhere; the package is only read.
 *
 * USAGE
 * -----
 *   npm run verify:timesheets-report -w backend/services/user -- \
 *     --timeclock <package>/timeclock --users <package>/users --workiz <capture.json> [--json <out.json>]
 */
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { Logger } from '@nestjs/common';
import { TIMESHEET_REPORT_MAX_DAYS, type TimeClockEntry, type TimesheetReportPage } from '@bitcrm/types';
import { TimesheetReportService } from '../technicians/timeclock/report/timesheet-report.service';
import {
  parseTimesheetReportQuery,
  type TimesheetReportQuery,
} from '../technicians/timeclock/report/timesheet-report.query';
import { daysInclusive } from '../technicians/timeclock/account-clock.util';
import { type TimeClockPerson } from '../technicians/timeclock/timeclock.repository';

interface WorkizRow {
  user_id: number | string;
  name: string;
  user_clocked_in?: boolean;
  total_time: number;
  gross_time: number;
  total_cost: number;
  gross_cost: number;
  jobs_count: number;
}

interface WorkizCase {
  name: string;
  from: string;
  to: string;
  job: string[];
  users: string[];
  q: string;
  sort: { id: string; desc: boolean };
  total_users: number;
  total: { total_time: number; gross_time: number; total_cost: number; gross_cost: number; jobs_count: number };
  rows: WorkizRow[];
  note?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function* lines(dir: string, prefix: string): AsyncGenerator<Record<string, unknown>> {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.jsonl')).sort()) {
    const rl = createInterface({ input: createReadStream(join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) if (line.trim()) yield JSON.parse(line) as Record<string, unknown>;
  }
}

/** The package rows behind the four reads `TimesheetReportService` makes of `TimeClockRepository`. */
class PackageTimeClock {
  readonly history: (TimeClockEntry & { GSI6PK: string; GSI6SK: string })[] = [];
  readonly open = new Set<string>();
  readonly people = new Map<string, TimeClockPerson>();
  readonly byWorkizUser = new Map<string, string>();

  async listStartedBetween(month: string, lo: string, hi: string): Promise<TimeClockEntry[]> {
    const pk = `TIMECLOCK#${month}`;
    return this.history.filter((e) => e.GSI6PK === pk && e.GSI6SK >= lo && e.GSI6SK <= hi);
  }

  async listByUserInRange(userId: string, lo: string, hi: string): Promise<TimeClockEntry[]> {
    return this.history.filter((e) => e.userId === userId && e.startedAt >= lo && e.startedAt <= `${hi}~`);
  }

  async peopleByIds(ids: string[]): Promise<Map<string, TimeClockPerson>> {
    return new Map(ids.filter((id) => this.people.has(id)).map((id) => [id, this.people.get(id)!]));
  }

  async openUserIds(ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.open.has(id)));
  }
}

async function loadPackage(timeclockDir: string, usersDir?: string): Promise<PackageTimeClock> {
  const repo = new PackageTimeClock();
  for await (const item of lines(timeclockDir, 'part-')) {
    if (String(item.SK).startsWith('CLOCK#')) repo.history.push(item as never);
  }
  for await (const op of lines(timeclockDir, 'conditional-')) {
    const it = (op as { item?: { SK?: string; userId?: string } }).item;
    if (it?.SK === 'CLOCK_OPEN' && it.userId) repo.open.add(it.userId);
  }
  if (usersDir) {
    for await (const item of lines(usersDir, 'part-')) {
      if (item.SK !== 'METADATA' || !String(item.PK).startsWith('USER#')) continue;
      const id = String(item.id);
      repo.people.set(id, {
        id,
        firstName: item.firstName as string | undefined,
        lastName: item.lastName as string | undefined,
        email: item.email as string | undefined,
      });
      const ext = String(item.externalId ?? '');
      if (ext.startsWith('workiz:user:')) repo.byWorkizUser.set(ext.slice('workiz:user:'.length), id);
    }
  }
  return repo;
}

const SORT: Record<string, string> = { name: 'name', total_time: 'hours', total_cost: 'cost', jobs_count: 'jobs' };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function main() {
  Logger.overrideLogger(['error', 'warn']);
  const tcDir = arg('timeclock');
  const workizPath = arg('workiz');
  if (!tcDir || !workizPath) {
    console.error('usage: --timeclock <dir> --users <dir> --workiz <capture.json> [--json <out>]');
    process.exit(2);
  }
  const repo = await loadPackage(tcDir, arg('users'));
  const capture = JSON.parse(readFileSync(workizPath, 'utf8')) as { cases: WorkizCase[] };
  const superAdmin = { getResolvedPermissions: async () => ({ isSystemRole: true, roleName: 'Super Admin', permissions: {} }) };
  const service = new TimesheetReportService(repo as never, superAdmin as never);
  const caller = { id: 'verify', cognitoSub: '', email: '', roleId: 'role-super-admin', department: '' };

  console.log(`package: ${repo.history.length} entries, ${repo.open.size} running, ${repo.people.size} people\n`);
  console.log('| case | period | Workiz: people · Hours · Gross · Cost · Gross cost · Jobs | BitCRM: same | difference |');
  console.log('|---|---|---|---|---|');
  const out: unknown[] = [];
  for (const c of capture.cases) {
    const userIds = c.users.map((w) => repo.byWorkizUser.get(w) ?? `workiz:${w}`);
    const sortId = SORT[c.sort.id] ?? 'name';
    // Workiz's picker stops at a year too ("All time" is left out of this report), but its API
    // answers any period — the all-time case is checked through the same service with the
    // one-year rule of the query parser stepped around.
    const long = daysInclusive(c.from, c.to) > TIMESHEET_REPORT_MAX_DAYS;
    const query: TimesheetReportQuery = parseTimesheetReportQuery({
      from: c.from,
      to: long ? c.from : c.to,
      ...(userIds.length ? { userId: userIds } : {}),
      ...(c.job.length ? { job: c.job } : {}),
      ...(c.q ? { q: c.q } : {}),
      sort: sortId,
      dir: c.sort.desc ? 'desc' : 'asc',
      pageSize: '1000',
    });
    if (long) query.to = c.to;
    const page: TimesheetReportPage = await service.report(query, caller as never);
    const w = c.total;
    const b = page.total;
    const diff: string[] = [];
    if (page.pagination.total !== c.total_users) diff.push(`people ${page.pagination.total - c.total_users}`);
    if (b.minutes !== w.total_time) diff.push(`Hours ${b.minutes - w.total_time} min`);
    if (b.grossMinutes !== w.gross_time) diff.push(`Gross ${b.grossMinutes - w.gross_time} min`);
    if (Math.abs((b.cost ?? 0) - w.total_cost) > 0.005) diff.push(`Cost ${((b.cost ?? 0) - w.total_cost).toFixed(2)}`);
    if (Math.abs((b.grossCost ?? 0) - w.gross_cost) > 0.005) diff.push(`Gross cost ${((b.grossCost ?? 0) - w.gross_cost).toFixed(2)}`);
    if (b.jobs !== w.jobs_count) diff.push(`Jobs ${b.jobs - w.jobs_count}`);

    // Row by row: which people differ, and by how much.
    const idOf = new Map([...repo.byWorkizUser].map(([wid, id]) => [id, wid]));
    const mine = new Map(page.rows.map((r) => [idOf.get(r.userId) ?? r.userId, r]));
    const rowDiffs: string[] = [];
    for (const wr of c.rows) {
      const r = mine.get(String(wr.user_id));
      if (!r) {
        rowDiffs.push(`${wr.name}: only in Workiz`);
        continue;
      }
      const d: string[] = [];
      if (r.minutes !== wr.total_time) d.push(`Hours ${r.minutes - wr.total_time}`);
      if (r.grossMinutes !== wr.gross_time) d.push(`Gross ${r.grossMinutes - wr.gross_time}`);
      if (Math.abs((r.cost ?? 0) - wr.total_cost) > 0.005) d.push(`Cost ${((r.cost ?? 0) - wr.total_cost).toFixed(2)}`);
      if (r.jobs !== wr.jobs_count) d.push(`Jobs ${r.jobs - wr.jobs_count}`);
      if (d.length) rowDiffs.push(`${wr.name}: ${d.join(', ')}`);
      mine.delete(String(wr.user_id));
    }
    if (c.rows.length === c.total_users) for (const r of mine.values()) rowDiffs.push(`${r.name}: only in BitCRM`);

    let order = '';
    if (c.name.includes('_sort_') && sortId !== 'name') {
      const key = sortId === 'hours' ? 'total_time' : sortId === 'cost' ? 'total_cost' : 'jobs_count';
      const wv = c.rows.map((r) => r[key as keyof WorkizRow]);
      const bv = page.rows.map((r) => (sortId === 'hours' ? r.minutes : sortId === 'cost' ? r.cost : r.jobs));
      order = JSON.stringify(wv) === JSON.stringify(bv) ? ' · order of values same' : ' · ORDER DIFFERS';
    }
    const fmt = (people: number, m: number, g: number, cost: number, gc: number, jobs: number) =>
      `${people} · ${hhmm(m)} · ${hhmm(g)} · $${cost.toFixed(2)} · $${gc.toFixed(2)} · ${jobs}`;
    console.log(
      `| ${c.name} | ${c.from}..${c.to}${c.job.length ? ` job=${c.job}` : ''}${c.q ? ` q="${c.q}"` : ''}${c.users.length ? ` team=${c.users.length}` : ''} ` +
        `| ${fmt(c.total_users, w.total_time, w.gross_time, w.total_cost, w.gross_cost, w.jobs_count)} ` +
        `| ${fmt(page.pagination.total, b.minutes, b.grossMinutes, b.cost ?? 0, b.grossCost ?? 0, b.jobs)} ` +
        `| ${diff.length ? diff.join('; ') : '0'}${order}${rowDiffs.length ? ` — ${rowDiffs.slice(0, 4).join('; ')}${rowDiffs.length > 4 ? ` (+${rowDiffs.length - 4})` : ''}` : ''} |`,
    );
    out.push({ case: c.name, note: c.note, workiz: { people: c.total_users, ...w }, bitcrm: { people: page.pagination.total, ...b }, diff, rowDiffs });
  }
  const json = arg('json');
  if (json) writeFileSync(json, JSON.stringify(out, null, 1));
}

main().catch((err) => {
  console.error('verify-timesheets-report failed:', err);
  process.exit(1);
});
