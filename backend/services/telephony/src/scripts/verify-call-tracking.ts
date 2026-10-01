/**
 * Replay Call Tracking over an import package, offline and read-only.
 *
 * Feeds the package's CALL# rows through the very arithmetic the endpoint
 * serves (`CallTrackingTally` → `serveTracking`), with job totals read off the
 * package's `DEAL#<id>/METADATA` rows the way deal-service's
 * `internal/deal-totals` reads them, and prints both groupings' cards — beside
 * Workiz's own live answer when its captured API responses are given.
 *
 *   npm run verify:call-tracking -w backend/services/telephony -- \
 *     --package /path/to/data/bitcrm.2026-09-30 --from 2026-09-01 --to 2026-09-27 \
 *     [--workiz /path/to/live_api_2026-09-01_27]      # …_flows.json / …_numbers.json
 *
 * Touches no database, no AWS.
 */
import { createReadStream, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { accountWindowUtc, type CallTrackingReport, type CallTrackingRow } from '@bitcrm/types';
import { CallTrackingTally, serveTracking, type TrackedCall } from '../calls/tracking/call-tracking';

const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PKG = opt('package');
const FROM = opt('from') ?? '2026-09-01';
const TO = opt('to') ?? '2026-09-27';
const WORKIZ = opt('workiz');

async function eachLine(dir: string, onLine: (line: string) => void): Promise<void> {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()) {
    const rl = createInterface({ input: createReadStream(join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) if (line) onLine(line);
  }
}

/** The same rule as deal-service's `dealTotalOf`. */
function dealTotalOf(item: Record<string, any>): number {
  if (typeof item.totals?.total === 'number') return item.totals.total;
  if (typeof item.jobTotalPrice === 'number') return item.jobTotalPrice;
  return 0;
}

/** Workiz's `HH:MM:SS` (or a bare 0) in seconds. */
const sec = (v: unknown) =>
  typeof v === 'string' && v.includes(':') ? v.split(':').map(Number).reduce((a, b) => a * 60 + b, 0) : Number(v) || 0;
const money = (n?: number) => (n === undefined ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dur = (s: number) => `${Math.floor(Math.floor(s) / 60)} Min ${Math.floor(s) % 60} Sec`;

function workizCards(file: string, groupBy: 'flows' | 'numbers') {
  const rows = (JSON.parse(readFileSync(file, 'utf8')).response.data ?? []) as Record<string, any>[];
  const sum = (k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return {
    rows,
    incomingCalls: sum('total_calls'),
    callers: sum('callers'),
    completed: sum('completed'),
    missedCalls: sum('unanswared'),
    jobs: sum('jobs'),
    revenue: Math.round(sum('revenue') * 100) / 100,
    conversion: Math.round((rows.reduce((a, r) => a + (Number(r.jobsConversionRate) || 0), 0) / rows.length) * 100) / 100,
    avgDurationSeconds: rows.reduce((a, r) => a + sec(r.avg_duration), 0) / rows.length,
    topFlow: groupBy === 'flows' ? rows[0]?.name?.trim() : 'N/A',
    count: rows.length,
  };
}

function table(report: CallTrackingReport, workiz?: ReturnType<typeof workizCards>) {
  const ours = report.cards;
  const sum = (f: (r: CallTrackingRow) => number) => report.rows.reduce((a, r) => a + f(r), 0);
  const lines: [string, string, string][] = [
    ['Rows (with calls)', String(report.rows.filter((r) => r.calls > 0).length), String(workiz?.count ?? '')],
    ['Incoming calls', String(ours.incomingCalls), String(workiz?.incomingCalls ?? '')],
    ['Callers', String(ours.callers), String(workiz?.callers ?? '')],
    ['Completed', String(sum((r) => r.completed)), String(workiz?.completed ?? '')],
    ['Missed calls', String(ours.missedCalls), String(workiz?.missedCalls ?? '')],
    ['Jobs', String(sum((r) => r.jobs)), String(workiz?.jobs ?? '')],
    ['Revenue', money(ours.revenue), workiz ? money(workiz.revenue) : ''],
    ['Conversion (card)', `${ours.conversion.toFixed(2)} %`, workiz ? `${workiz.conversion.toFixed(2)} %` : ''],
    ['Avg Duration (card)', `${ours.avgDurationSeconds.toFixed(1)} s → ${dur(ours.avgDurationSeconds)}`, workiz ? `${workiz.avgDurationSeconds.toFixed(1)} s → ${dur(workiz.avgDurationSeconds)}` : ''],
    ['Top Flow', ours.topFlow ?? 'N/A', workiz?.topFlow ?? ''],
  ];
  console.log(`\n| ${report.groupBy === 'flows' ? 'By Call Flow' : 'By Phone Number'} | BitCRM (this endpoint) | Workiz (live) |`);
  console.log('|---|---|---|');
  for (const [k, a, b] of lines) console.log(`| ${k} | ${a} | ${b} |`);
}

async function main(): Promise<void> {
  if (!PKG) throw new Error('--package <dir> is required');
  const window = { from: FROM, to: TO, ...accountWindowUtc(FROM, TO) };
  const tally = new CallTrackingTally(window);
  const numbers: { phoneNumber: string; sourceId?: string }[] = [];
  const months = new Set([window.start.slice(0, 7), window.end.slice(0, 7)]);

  await eachLine(join(PKG, 'calls'), (line) => {
    if (line.startsWith('{"PK":"NUMSET#ALL"')) {
      const n = JSON.parse(line);
      numbers.push({ phoneNumber: n.SK, sourceId: n.sourceId });
      return;
    }
    const m = /"GSI2PK":"CALL#(\d{4}-\d{2})"/.exec(line);
    if (!m || !months.has(m[1])) return;
    tally.add(JSON.parse(line) as TrackedCall);
  });

  const flowCatalog: { id: string; name: string; numbers?: string[] }[] = [];
  if (existsSync(join(PKG, 'call_flows'))) {
    await eachLine(join(PKG, 'call_flows'), (line) => {
      const f = JSON.parse(line);
      if (f.PK === 'FLOW' && f.id) flowCatalog.push({ id: f.id, name: f.name, numbers: f.numbers });
    });
  }

  const wanted = new Set(tally.dealIds());
  const totals = new Map<string, number>();
  await eachLine(join(PKG, 'deals'), (line) => {
    const m = /^\{"PK":"DEAL#([^"]+)","SK":"METADATA"/.exec(line);
    if (!m || !wanted.has(m[1])) return;
    totals.set(m[1], dealTotalOf(JSON.parse(line)));
  });

  const snapshot = tally.snapshot({ totals, flowCatalog, numbers });
  console.log(`Package: ${PKG}`);
  console.log(`Window:  ${FROM} … ${TO} (America/New_York) = ${window.start} … ${window.end}`);
  console.log(`Calls counted: ${tally.size}; jobs that are deals: ${wanted.size}, totals found: ${totals.size}; numbers known: ${snapshot.numbers.length}; flows in catalog: ${flowCatalog.length}`);

  for (const groupBy of ['flows', 'numbers'] as const) {
    const report = serveTracking(snapshot, { groupBy, graphBy: 'day', withRevenue: true });
    const file = WORKIZ ? `${WORKIZ}_${groupBy}.json` : undefined;
    const workiz = file && existsSync(file) ? workizCards(file, groupBy) : undefined;
    table(report, workiz);

    if (workiz) {
      // Row by row: a flow by its name, a number by its digits.
      const keyOf = (w: Record<string, any>) =>
        groupBy === 'flows' ? String(w.name).trim() : `+1${String(w.number).replace(/\D/g, '').slice(-10)}`;
      const ourKey = (r: CallTrackingRow) => (groupBy === 'flows' ? r.name.trim() : r.number ?? '');
      const theirs = new Map(workiz.rows.map((w) => [keyOf(w), w]));
      const live = report.rows.filter((r) => r.calls > 0);
      const same = (f: (r: CallTrackingRow, w: Record<string, any>) => boolean) =>
        live.filter((r) => {
          const w = theirs.get(ourKey(r));
          return !!w && f(r, w);
        }).length;
      const stats = [
        ['calls + callers', same((r, w) => w.total_calls === r.calls && w.callers === r.callers)],
        ['completed + missed', same((r, w) => w.completed === r.completed && w.unanswared === r.missed)],
        ['avg duration (to the second)', same((r, w) => sec(w.avg_duration) === r.avgDurationSeconds)],
        ['jobs', same((r, w) => w.jobs === r.jobs)],
        ['revenue (to the cent)', same((r, w) => Math.abs((Number(w.revenue) || 0) - (r.revenue ?? 0)) < 0.005)],
      ] as const;
      console.log(`\nRow by row against Workiz (${live.length} rows with calls):`);
      for (const [what, n] of stats) console.log(`  ${what}: ${n} of ${live.length}`);
      const odd = live
        .map((r) => ({ r, w: theirs.get(ourKey(r)) }))
        .filter(({ r, w }) => !w || w.completed !== r.completed || w.unanswared !== r.missed)
        .slice(0, 6)
        .map(({ r, w }) => `  ${r.name}: completed ${r.completed}/${w?.completed}, missed ${r.missed}/${w?.unanswared}`);
      if (odd.length) console.log(odd.join('\n'));
    }
  }

  const g = snapshot.graphs.day;
  console.log(`\nGraph by day: ${g.buckets.length} buckets, ${g.series.length} lines (${g.series.map((s) => s.name).join(' · ')}); Σ = ${g.series.reduce((a, s) => a + s.counts.reduce((x, y) => x + y, 0), 0)}`);
}

main().catch((err) => {
  console.error('verify-call-tracking failed:', err);
  process.exit(1);
});
