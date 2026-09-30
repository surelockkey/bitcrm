/**
 * Replay Reports → Activity over an import package, offline and read-only.
 *
 * Files the package's timeline rows with the writer's own `activityIndexFields`
 * into an in-memory stand-in for the two indexes and the day counters (what
 * `backfill:activity-index` + `recount:activity` produce), then asks the real
 * `ActivityService` — list, count, search — the questions Workiz was asked
 * live, and prints the answers beside Workiz's.
 *
 *   npm run verify:activity -w backend/services/deal -- \
 *     --package /path/to/data/bitcrm.2026-09-30 --from 2026-09-01 --to 2026-09-27 \
 *     [--workiz /path/to/activity/live_api_2026-09-01_27.json]
 *
 * Touches no database, no AWS.
 */
import { createReadStream, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { AccountClock, accountWindowUtc, shiftAccountDay } from '@bitcrm/types';
import { activityIndexFields, isImported } from '../activity/activity-index';
import { ActivityRepository } from '../activity/activity.repository';
import { ActivityCountsRepository } from '../activity/activity-counts.repository';
import { ActivityService } from '../activity/activity.service';

const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PKG = opt('package');
const FROM = opt('from') ?? '2026-09-01';
const TO = opt('to') ?? '2026-09-27';
const WORKIZ = opt('workiz');

type Item = Record<string, any>;

/** Query / BatchGet / Get over in-memory rows — the shapes ActivityRepository sends. */
function memoryDynamo(rows: Item[], counters: Map<string, number>) {
  const byDay = new Map<string, Item[]>();
  const byActor = new Map<string, Item[]>();
  for (const r of rows) {
    if (!byDay.has(r.GSI8PK)) byDay.set(r.GSI8PK, []);
    byDay.get(r.GSI8PK)!.push(r);
    if (r.GSI9PK) {
      if (!byActor.has(r.GSI9PK)) byActor.set(r.GSI9PK, []);
      byActor.get(r.GSI9PK)!.push(r);
    }
  }
  for (const list of [...byDay.values(), ...byActor.values()]) list.sort((a, b) => (a.GSI8SK < b.GSI8SK ? -1 : 1));
  const send = async (cmd: { constructor: { name: string }; input: any }) => {
    const input = cmd.input;
    switch (cmd.constructor.name) {
      case 'GetCommand':
        return {};
      case 'BatchGetCommand': {
        const [table, req] = Object.entries(input.RequestItems)[0] as [string, { Keys: Item[] }];
        const items = req.Keys.filter((k) => String(k.PK).startsWith('ACTCOUNT#'))
          .map((k) => ({ ...k, count: counters.get(String(k.PK).slice('ACTCOUNT#'.length)) }))
          .filter((it) => it.count !== undefined);
        return { Responses: { [table]: items } };
      }
      case 'QueryCommand': {
        const v = input.ExpressionAttributeValues;
        const day = input.IndexName === 'ActivityDayIndex';
        const sk = day ? 'GSI8SK' : 'GSI9SK';
        let list = [...((day ? byDay : byActor).get(v[':pk']) ?? [])];
        if (v[':lo'] !== undefined) list = list.filter((it) => it[sk] >= v[':lo'] && it[sk] <= v[':hi']);
        if (input.ScanIndexForward === false) list.reverse();
        if (input.ExclusiveStartKey) list = list.slice(list.findIndex((it) => it[sk] === input.ExclusiveStartKey[sk]) + 1);
        const evaluated = input.Limit ? list.slice(0, input.Limit) : list;
        const more = evaluated.length < list.length;
        const found = input.FilterExpression
          ? evaluated.filter((it) => String(it.activitySearch).includes(v[':q']) || (v[':qDeal'] && it.dealId === v[':qDeal']))
          : evaluated;
        const last = evaluated[evaluated.length - 1];
        const LastEvaluatedKey = more ? { PK: last.PK, SK: last.SK, [sk]: last[sk] } : undefined;
        return input.Select === 'COUNT' ? { Count: found.length, LastEvaluatedKey } : { Items: found, LastEvaluatedKey };
      }
      default:
        throw new Error(`unexpected ${cmd.constructor.name}`);
    }
  };
  return { client: { send } };
}

async function main(): Promise<void> {
  if (!PKG) throw new Error('--package <dir> is required');
  const clock = new AccountClock();
  const { start, end } = accountWindowUtc(shiftAccountDay(FROM, -1), shiftAccountDay(TO, 1));
  const months = new Set([start.slice(0, 7), end.slice(0, 7), FROM.slice(0, 7), TO.slice(0, 7)]);
  const rows: Item[] = [];
  const counters = new Map<string, number>();
  const kinds = { deal: 0, act: 0, skipped: 0, mobile: 0, web: 0 };
  const dir = join(PKG, 'timeline');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()) {
    const rl = createInterface({ input: createReadStream(join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      const m = /"timestamp":"(\d{4}-\d{2})/.exec(line);
      if (!m || !months.has(m[1])) continue;
      const item = JSON.parse(line) as Item;
      if (item.timestamp < start || item.timestamp >= end) continue;
      const fields = activityIndexFields(item, clock);
      if (!fields) {
        kinds.skipped += 1;
        continue;
      }
      const row = { ...item, ...fields };
      rows.push(row);
      const day = fields.GSI8PK.slice('ACTDAY#'.length);
      counters.set(day, (counters.get(day) ?? 0) + 1);
      if (day >= FROM && day <= TO) {
        if (String(item.SK).startsWith('ACT#')) kinds.act += 1;
        else kinds.deal += 1;
        if (isImported(item) && item.details?.workiz?.native) kinds.mobile += 1;
        else kinds.web += 1;
      }
    }
  }

  const db = memoryDynamo(rows, counters) as never;
  const service = new ActivityService(new ActivityRepository(db), new ActivityCountsRepository(db));
  const workiz = WORKIZ && existsSync(WORKIZ) ? JSON.parse(readFileSync(WORKIZ, 'utf8')) : undefined;

  const period = { from: FROM, to: TO };
  const checks: [string, Promise<{ total: number; atLeast: boolean }>, unknown][] = [
    [`All events ${FROM} … ${TO}`, service.count(period), workiz?.total],
    ['Day 2026-09-01', service.count({ from: '2026-09-01', to: '2026-09-01' }), workiz?.['day_2026-09-01']],
    ['Day 2026-09-15', service.count({ from: '2026-09-15', to: '2026-09-15' }), workiz?.['day_2026-09-15']],
    ['Day 2026-09-27', service.count({ from: '2026-09-27', to: '2026-09-27' }), workiz?.['day_2026-09-27']],
    ['Search "Logged In"', service.count({ ...period, q: 'Logged In' }), workiz?.search_Logged_In],
    ['Search "EBKZ0I" (a Job Id)', service.count({ ...period, q: 'EBKZ0I' }), 35],
  ];
  console.log(`Package: ${PKG}`);
  console.log(`Rows filed: ${rows.length} (${kinds.skipped} timeline rows that are not Activity events left out)`);
  console.log(`In ${FROM} … ${TO}: job timeline ${kinds.deal}, job-less ACT# ${kinds.act}; web ${kinds.web}, mobile ${kinds.mobile}\n`);
  console.log('| Check | BitCRM (this endpoint) | Workiz (live) |');
  console.log('|---|---|---|');
  for (const [label, answer, theirs] of checks) {
    const a = await answer;
    console.log(`| ${label} | ${a.total.toLocaleString('en-US')}${a.atLeast ? '+' : ''} | ${typeof theirs === 'number' ? theirs.toLocaleString('en-US') : '—'} |`);
  }

  const page = await service.list({ ...period, limit: 10 });
  console.log(`\nFirst page, newest first (Workiz: "Sun Sep 27, 2026 11:55 pm · Logged Out · (1) (Melanie) 29 Dispatcher"):`);
  for (const r of page.items.slice(0, 3)) {
    const t = new Date(r.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    console.log(`  ${t} · ${r.text} · ${r.actorName}${r.jobRef ? ` · ${r.jobRef}` : ''} · ${r.source ?? '?'}`);
  }
  const asc = await service.list({ ...period, limit: 1, sort: 'asc' });
  console.log(`Oldest first starts at: ${asc.items[0]?.timestamp} (${asc.items[0]?.text})`);
}

main().catch((err) => {
  console.error('verify-activity failed:', err);
  process.exit(1);
});
