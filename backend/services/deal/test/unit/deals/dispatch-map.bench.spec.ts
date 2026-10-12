/**
 * Bench: the dispatch map's read against a fake DynamoDB that holds the REAL
 * row counts, the old drain beside it.
 *
 * Counts (read from the import dumps, not from AWS):
 * - dev = `data/bitcrm.slice5k-1001c`: submitted 198, in_progress 1, pending 233,
 *   done_pending_approval 0 open (the board said 442 on 2026-10-12: a few made on dev);
 * - the whole account (`data/bitcrm.2026-10-01c`): submitted 658, in_progress 2,
 *   pending 310, done_pending_approval 186; Done ≈ 1 400 and Canceled ≈ 3 200 a month.
 * Row sizes are the dumps' averages (3.6–4.6 KB a METADATA row).
 *
 * The fake answers a Query the way DynamoDB does — key order, `Limit` counted
 * on rows READ, a 1 MB cut BEFORE the filter and the projection, the filter
 * after — and takes `QUERY_BASE_MS + QUERY_MS_PER_MB × MB read` to answer.
 * crm's by-ids takes `CRM_BASE_MS + CRM_MS_PER_ID × ids`. Each browser↔API
 * round trip costs `RTT_MS`. Those latencies are a MODEL (in-region DynamoDB
 * and an internal hop, a browser in the US); the counts, the number of
 * requests and the bytes are exact. Run: `npx jest dispatch-map.bench`;
 * `DISPATCH_MAP_BENCH=1` adds the Week / Month + Done / Canceled windows.
 *
 * Measured 2026-10-12 (this model):
 *   dev open jobs        drain  564 ms ·  8 HTTP → /map 147 ms · 1 HTTP · 309 KB (15 KB gz)
 *   account open jobs    drain 1252 ms · 15 HTTP → /map 199 ms · 1 HTTP · 845 KB (39 KB gz)
 *   account Week + D/C   drain 1582 ms · 27 HTTP → /map 196 ms · 2 HTTP
 *   account Month + D/C  drain 5660 ms · 61 HTTP → /map 192 ms · 2 HTTP (69 one-day queries at once)
 */
import { gzipSync } from 'node:zlib';
import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { JobSuperStatus, SUPER_STATUS_ORDER, type Deal } from '@bitcrm/types';
import { DealsRepository } from 'src/deals/deals.repository';
import { DealsService } from 'src/deals/deals.service';
import { DispatchMapService } from 'src/deals/map/dispatch-map.service';
import { createMockJwtUser } from '../mocks';

const QUERY_BASE_MS = 8;
const QUERY_MS_PER_MB = 25;
const CRM_BASE_MS = 30;
const CRM_MS_PER_ID = 0.2;
const ELIGIBILITY_MS = 8;
const RTT_MS = 60;
const MB = 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = Record<string, unknown> & { PK: string; SK: string; GSI5PK: string; GSI5SK: string };

/** A DynamoDB of METADATA rows on the StatusScheduleIndex, honest about pages. */
class FakeDynamo {
  queries = 0;
  bytesRead = 0;
  private byPk = new Map<string, Row[]>();
  private sizes = new Map<Row, number>();

  constructor(rows: Row[]) {
    for (const r of rows) {
      const list = this.byPk.get(r.GSI5PK) ?? [];
      list.push(r);
      this.byPk.set(r.GSI5PK, list);
      this.sizes.set(r, JSON.stringify(r).length);
    }
    for (const list of this.byPk.values()) list.sort((a, b) => (a.GSI5SK < b.GSI5SK ? -1 : a.GSI5SK > b.GSI5SK ? 1 : 0));
  }

  client = { send: (cmd: unknown) => this.send(cmd) };

  private async send(cmd: unknown): Promise<unknown> {
    if (cmd instanceof QueryCommand) return this.query(cmd.input as any);
    if (cmd instanceof BatchGetCommand) return { Responses: {} };
    throw new Error(`fake: unexpected ${String((cmd as object)?.constructor?.name)}`);
  }

  private async query(input: any) {
    if (input.IndexName !== 'StatusScheduleIndex') throw new Error(`fake: index ${input.IndexName}`);
    const names: Record<string, string> = input.ExpressionAttributeNames ?? {};
    const values: Record<string, unknown> = input.ExpressionAttributeValues ?? {};
    let list = this.byPk.get(values[':pk'] as string) ?? [];
    if (/BETWEEN/.test(input.KeyConditionExpression)) {
      list = list.filter((r) => r.GSI5SK >= (values[':from'] as string) && r.GSI5SK <= (values[':to'] as string));
    } else if (input.KeyConditionExpression !== '#pk = :pk') {
      throw new Error(`fake: key condition ${input.KeyConditionExpression}`);
    }
    if (input.ScanIndexForward === false) list = [...list].reverse();
    let i = 0;
    if (input.ExclusiveStartKey) i = list.findIndex((r) => r.PK === input.ExclusiveStartKey.PK) + 1;
    const items: Record<string, unknown>[] = [];
    let size = 0;
    let read = 0;
    for (; i < list.length; i++) {
      const s = this.sizes.get(list[i])!;
      if ((read > 0 && size + s > MB) || (input.Limit && read >= input.Limit)) break;
      size += s;
      read += 1;
      if (this.passes(list[i], input.FilterExpression, names, values)) items.push(this.project(list[i], input.ProjectionExpression, names));
    }
    const last = i < list.length ? list[i - 1] : undefined;
    this.queries += 1;
    this.bytesRead += size;
    await sleep(QUERY_BASE_MS + (size / MB) * QUERY_MS_PER_MB);
    return {
      Items: items,
      Count: items.length,
      ScannedCount: read,
      ...(last && { LastEvaluatedKey: { PK: last.PK, SK: last.SK, GSI5PK: last.GSI5PK, GSI5SK: last.GSI5SK } }),
    };
  }

  private passes(row: Row, filter: string | undefined, names: Record<string, string>, values: Record<string, unknown>) {
    if (!filter) return true;
    return filter.split(' AND ').every((term) => {
      let m = /^#(\w+) = (:\w+)$/.exec(term);
      if (m) return row[names[`#${m[1]}`]] === values[m[2]];
      m = /^contains\(#(\w+), (:\w+)\)$/.exec(term);
      if (m) return ((row[names[`#${m[1]}`]] as string[]) ?? []).includes(values[m[2]] as string);
      throw new Error(`fake: filter term ${term}`);
    });
  }

  private project(row: Row, projection: string | undefined, names: Record<string, string>) {
    if (!projection) return { ...row };
    const out: Record<string, unknown> = {};
    for (const alias of projection.split(',').map((s) => s.trim())) {
      const attr = names[alias] ?? alias;
      if (row[attr] !== undefined) out[attr] = row[attr];
    }
    return out;
  }
}

/** Rows shaped like the import's: the visit day in the key, a tech on most, a client per job (some repeat). */
function rowsOf(status: JobSuperStatus, count: number, avgBytes: number, day: (i: number) => string): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `${status}-${String(i).padStart(5, '0')}`;
    const date = day(i);
    const slot = `${String(8 + (i % 10)).padStart(2, '0')}:00`;
    const base: Row = {
      PK: `DEAL#${id}`,
      SK: 'METADATA',
      GSI5PK: `STATUS#${status}`,
      GSI5SK: `${date}#${slot}#DEAL#${id}`,
      id,
      dealNumber: id.slice(-6).toUpperCase(),
      contactId: `c-${status}-${Math.floor(i * 0.92)}`,
      clientType: 'residential',
      serviceArea: 'Dallas',
      address: { street: `${i} Elm St`, city: 'Dallas', state: 'TX', zip: '75201', lat: 32.7 + i / 1e4, lng: -96.8 },
      jobTypeId: 'jt-lockout',
      superStatus: status,
      scheduledDate: date,
      scheduledTimeSlot: `${slot}-${String(9 + (i % 10)).padStart(2, '0')}:00`,
      assignedTechIds: i % 7 === 0 ? [] : [`t-${i % 31}`],
      assignedDispatcherId: 'u-disp',
      sequences: {},
      priority: 'normal',
      tagIds: ['tag-1'],
      phones: ['+12145550100'],
      status: 'active',
      createdBy: 'u-disp',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };
    // The rest of a real row: notes, money, custom answers, the search halves.
    const pad = Math.max(0, avgBytes - JSON.stringify(base).length);
    return { ...base, notes: 'x'.repeat(pad) };
  });
}

const openDay = (i: number) => `2026-${String(1 + (i % 10)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;

interface Scenario {
  name: string;
  open: Partial<Record<JobSuperStatus, [count: number, avgBytes: number]>>;
  /** Done / Canceled per visit day, over `days`. */
  closedPerDay?: Partial<Record<JobSuperStatus, [count: number, avgBytes: number]>>;
  days?: string[];
}

const OCTOBER = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const WEEK = OCTOBER.slice(10, 17);

const DEV: Scenario['open'] = {
  [JobSuperStatus.SUBMITTED]: [198, 3992],
  [JobSuperStatus.IN_PROGRESS]: [1, 3908],
  [JobSuperStatus.PENDING]: [233, 3818],
};
const ACCOUNT: Scenario['open'] = {
  [JobSuperStatus.SUBMITTED]: [658, 3551],
  [JobSuperStatus.IN_PROGRESS]: [2, 4075],
  [JobSuperStatus.PENDING]: [310, 3881],
  [JobSuperStatus.DONE_PENDING_APPROVAL]: [186, 4633],
};
const CLOSED_A_DAY: Scenario['closedPerDay'] = {
  [JobSuperStatus.DONE]: [45, 4627],
  [JobSuperStatus.CANCELED]: [103, 3791],
};

function build(s: Scenario): FakeDynamo {
  const rows: Row[] = [];
  for (const [status, [n, bytes]] of Object.entries(s.open) as [JobSuperStatus, [number, number]][]) {
    rows.push(...rowsOf(status, n, bytes, openDay));
  }
  for (const [status, [perDay, bytes]] of Object.entries(s.closedPerDay ?? {}) as [JobSuperStatus, [number, number]][]) {
    const days = s.days ?? [];
    rows.push(...rowsOf(status, perDay * days.length, bytes, (i) => days[i % days.length]));
  }
  return new FakeDynamo(rows);
}

/** crm and the eligibility projection, as slow as the model says. */
function collaborators() {
  const calls = { crm: 0 };
  const names = (ids: string[]) => ids.map((id) => ({ id, firstName: `F${id}`, lastName: `L${id}` }));
  const internalHttp = {
    getContactNames: async (ids: string[]) => {
      calls.crm += 1;
      await sleep(CRM_BASE_MS + CRM_MS_PER_ID * ids.length);
      return names(ids);
    },
    getContactsAsCaller: async (ids: string[]) => {
      calls.crm += 1;
      await sleep(CRM_BASE_MS + CRM_MS_PER_ID * ids.length);
      return names(ids).map((n) => ({ ...n, phones: ['+12145550199'], emails: [`${n.id}@x.test`] }));
    },
  };
  const eligibility = {
    getMany: async (ids: string[]) => {
      await sleep(ELIGIBILITY_MS);
      return ids.map((id) => ({ technicianId: id, firstName: 'Tech', lastName: id }));
    },
  };
  return { calls, internalHttp, eligibility };
}

interface Measured {
  ms: number;
  requests: number;
  queries: number;
  mbRead: number;
  jobs: number;
  kb: number;
  gzKb: number;
}

const kb = (body: unknown) => Buffer.byteLength(JSON.stringify(body)) / 1024;
const gzKb = (body: unknown) => gzipSync(JSON.stringify(body)).length / 1024;

/** The new read: one `GET /deals/map` (+ a second for Done / Canceled when ticked, at once). */
async function measureMap(s: Scenario, closed?: JobSuperStatus[]): Promise<Measured> {
  const db = build(s);
  const { internalHttp, eligibility } = collaborators();
  const map = new DispatchMapService(new DealsRepository(db as any), internalHttp as any, eligibility as any);
  const user = createMockJwtUser();
  const started = Date.now();
  const asks = [{}] as Array<Record<string, string>>;
  if (closed?.length && s.days) asks.push({ statuses: closed.join(','), from: s.days[0], to: s.days[s.days.length - 1] });
  const answers = await Promise.all(
    asks.map(async (q) => {
      const a = await map.read(q, user, 'all', { numbers: true, authorization: 'Bearer x' });
      await sleep(RTT_MS);
      return { success: true, data: a.deals, pagination: { count: a.deals.length }, included: a.included };
    }),
  );
  const ms = Date.now() - started;
  return {
    ms,
    requests: answers.length,
    queries: db.queries,
    mbRead: db.bytesRead / MB,
    jobs: answers.reduce((n, a) => n + a.data.length, 0),
    kb: answers.reduce((n, a) => n + kb(a), 0),
    gzKb: answers.reduce((n, a) => n + gzKb(a), 0),
  };
}

/** The old read: the jobs list drained 100 a page per status, then crm by-ids for every client. */
async function measureDrain(s: Scenario, closed?: JobSuperStatus[]): Promise<Measured> {
  const db = build(s);
  const { internalHttp, eligibility } = collaborators();
  const stub = {} as any;
  const service = new DealsService(
    new DealsRepository(db as any), stub, stub, stub, internalHttp as any,
    stub, stub, stub, stub, stub, stub, stub, stub, eligibility as any,
  );
  const user = createMockJwtUser();
  let requests = 0;
  let bytes = 0;
  let gz = 0;
  const drain = async (query: Record<string, unknown>): Promise<Deal[]> => {
    const out: Deal[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.list({ ...query, cursor } as any, user, 'all', { numbers: true });
      const included = await service.includedFor(page.items);
      await sleep(RTT_MS);
      requests += 1;
      const body = { success: true, data: page.items, pagination: { nextCursor: page.nextCursor }, included };
      bytes += kb(body);
      gz += gzKb(body);
      out.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  };
  const started = Date.now();
  const open = SUPER_STATUS_ORDER.filter((st) => st !== JobSuperStatus.DONE && st !== JobSuperStatus.CANCELED);
  const reads = open.map((superStatus) => drain({ superStatus, sort: 'schedule', dir: 'asc', limit: 100 }));
  if (closed?.length && s.days) {
    for (const superStatus of closed) {
      reads.push(drain({ superStatus, scheduledFrom: s.days[0], scheduledTo: s.days[s.days.length - 1], sort: 'schedule', dir: 'asc', limit: 100 }));
    }
  }
  const deals = (await Promise.all(reads)).flat();
  // Then the browser asks crm for the clients, one body with every id.
  const ids = [...new Set(deals.map((d) => d.contactId))];
  const contacts = await internalHttp.getContactsAsCaller(ids);
  await sleep(RTT_MS);
  requests += 1;
  bytes += kb(contacts);
  gz += gzKb(contacts);
  return { ms: Date.now() - started, requests, queries: db.queries, mbRead: db.bytesRead / MB, jobs: deals.length, kb: bytes, gzKb: gz };
}

const table: string[] = [];
const fmt = (m: Measured) =>
  `${String(m.ms).padStart(5)} ms · ${String(m.requests).padStart(2)} HTTP · ${String(m.queries).padStart(3)} queries · ` +
  `${m.mbRead.toFixed(1)} MB read · ${m.jobs} jobs · ${Math.round(m.kb)} KB (${Math.round(m.gzKb)} KB gz)`;

describe('dispatch map — bench against the real row counts', () => {
  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(
      `latency model: query ${QUERY_BASE_MS} ms + ${QUERY_MS_PER_MB} ms/MB, crm ${CRM_BASE_MS} ms + ${CRM_MS_PER_ID} ms/id, ` +
        `round trip ${RTT_MS} ms\n${table.join('\n')}`,
    );
  });

  const scenarios: Array<[string, Scenario, JobSuperStatus[] | undefined]> = [
    ['dev (slice 5k): open jobs', { name: 'dev', open: DEV }, undefined],
    ['whole account: open jobs', { name: 'account', open: ACCOUNT }, undefined],
  ];
  // The closed windows sleep through the old drain's dozens of pages (seconds):
  // only on request, so the everyday suite stays quick on the laptop.
  if (process.env.DISPATCH_MAP_BENCH) {
    scenarios.push(
      [
        'whole account: Week + Done/Canceled',
        { name: 'account-week', open: ACCOUNT, closedPerDay: CLOSED_A_DAY, days: WEEK },
        [JobSuperStatus.DONE, JobSuperStatus.CANCELED],
      ],
      [
        'whole account: Month + Done/Canceled',
        { name: 'account-month', open: ACCOUNT, closedPerDay: CLOSED_A_DAY, days: OCTOBER },
        [JobSuperStatus.DONE, JobSuperStatus.CANCELED],
      ],
    );
  }

  it.each(scenarios)('%s', async (label, scenario, closed) => {
    const before = await measureDrain(scenario, closed);
    const after = await measureMap(scenario, closed);
    table.push(`${label}\n  drain  ${fmt(before)}\n  /map   ${fmt(after)}`);

    // The same jobs, in far fewer round trips, reading less.
    expect(after.jobs).toBe(before.jobs);
    expect(after.requests).toBeLessThanOrEqual(2);
    expect(after.requests).toBeLessThan(before.requests);
    expect(after.ms).toBeLessThan(before.ms);
    expect(after.mbRead).toBeLessThanOrEqual(before.mbRead + 0.01);
  }, 30_000);
});
