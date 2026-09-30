import {
  AccountClock,
  accountDaysBetween,
  CALL_TRACKING_GRAPH_BY,
  CALL_TRACKING_GRAPH_SERIES,
  CALL_TRACKING_OTHER_SERIES,
  weekStartSunday,
  type CallTrackingCards,
  type CallTrackingGraph,
  type CallTrackingGraphBy,
  type CallTrackingGroupBy,
  type CallTrackingReport,
  type CallTrackingRow,
} from '@bitcrm/types';

/**
 * Workiz's Call Tracking, as arithmetic — no I/O here, so the rules can be
 * pinned by tests and replayed over an import package (`verify:call-tracking`).
 *
 * The rules are Workiz's, checked against its live report for 1–27 Sep 2026
 * (docs/reports/call-tracking.md in the migration repo):
 *
 *  - only INBOUND calls count, the hidden internal leg never;
 *  - answered = Workiz `dial_call_status` completed; missed = the dial status
 *    is empty (nobody picked up). A dial that ended no-answer / busy is a call
 *    but neither answered nor missed. Our own calls carry no dial status:
 *    answered = somebody picked up (`answeredAt`, or a completed status);
 *  - callers = distinct caller numbers within the row;
 *  - jobs = distinct jobs of the row's calls, WHATEVER their status — 2,038 of
 *    Workiz's 3,073 jobs in the check period were Canceled. An imported call
 *    whose job never became a deal (deleted, or a lead) still counts, by its
 *    Workiz job id; it just brings no revenue;
 *  - conversion = jobs / callers × 100, two decimals;
 *  - the cards are sums of the rows, except Avg Duration and Conversion —
 *    plain means of the rows — and Top Flow, the first row (N/A by number).
 *    Workiz's number view adds one phantom job to nearly every number (it
 *    counts the empty job id as a job); that bug is not copied.
 */

/** The attributes the report reads off a call row (the walk projects exactly these). */
export interface TrackedCall {
  callSid?: string;
  startedAt: string;
  direction?: string;
  from?: string;
  to?: string;
  status?: string;
  answeredAt?: string;
  durationSeconds?: number;
  flowId?: string;
  flowName?: string;
  /** Imported calls: Workiz's flow id (always), beside `flowId` when the flow was imported. */
  workizFlowId?: string | number;
  dealId?: string;
  /** Imported calls: Workiz's job id — present even when the job never became a deal. */
  workizJobId?: string | number;
  sourceId?: string;
  externalId?: string;
  /** Imported calls: Workiz's raw answer state — the one its report counts by. */
  dialCallStatus?: string;
  internalLegOf?: string;
}

export const TRACKED_CALL_ATTRIBUTES: (keyof TrackedCall)[] = [
  'callSid',
  'startedAt',
  'direction',
  'from',
  'to',
  'status',
  'answeredAt',
  'durationSeconds',
  'flowId',
  'flowName',
  'workizFlowId',
  'dealId',
  'workizJobId',
  'sourceId',
  'externalId',
  'dialCallStatus',
];

export type AnswerClass = 'answered' | 'missed' | 'neither';

const LIVE = new Set(['queued', 'initiated', 'ringing', 'in-progress']);

/** Came over from Workiz — its raw dial status is the truth for this report. */
export function isImportedCall(call: TrackedCall): boolean {
  return typeof call.externalId === 'string' && call.externalId.startsWith('workiz:call:');
}

export function answerClassOf(call: TrackedCall): AnswerClass {
  if (isImportedCall(call)) {
    const dial = (call.dialCallStatus ?? '').trim().toLowerCase();
    if (dial === 'completed') return 'answered';
    return dial ? 'neither' : 'missed';
  }
  if (call.answeredAt || call.status === 'completed') return 'answered';
  // Still ringing: not missed yet.
  if (call.status && LIVE.has(call.status)) return 'neither';
  return 'missed';
}

/** Whether the report counts the call at all. */
export function isTrackedCall(call: TrackedCall): boolean {
  return call.direction === 'inbound' && !call.internalLegOf && typeof call.startedAt === 'string';
}

/** The flow a call belongs to: the catalog id, else Workiz's id, else the name. */
export function flowKeyOf(call: TrackedCall): string {
  if (call.flowId) return call.flowId;
  if (call.workizFlowId !== undefined && call.workizFlowId !== null && `${call.workizFlowId}` !== '' && `${call.workizFlowId}` !== '0') {
    return `workiz:${call.workizFlowId}`;
  }
  const name = (call.flowName ?? '').trim();
  return name ? `name:${name}` : 'none';
}

/** The job a call led to: the deal, else Workiz's job id (a job that is not a deal here). */
export function jobKeyOf(call: TrackedCall): string | undefined {
  if (call.dealId) return call.dealId;
  const w = call.workizJobId;
  if (w !== undefined && w !== null && `${w}` !== '' && `${w}` !== '0') return `workiz:${w}`;
  return undefined;
}

/** `+12034036303` → `(203) 403-6303`; anything else as it came. */
export function formatTrackedNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A value counted by how often it was seen, ties to the most recent. */
class Votes {
  private readonly seen = new Map<string, { n: number; last: string }>();
  add(value: string | undefined, at: string): void {
    if (!value) return;
    const v = this.seen.get(value);
    if (v) {
      v.n += 1;
      if (at > v.last) v.last = at;
    } else {
      this.seen.set(value, { n: 1, last: at });
    }
  }
  winner(): string | undefined {
    let best: [string, { n: number; last: string }] | undefined;
    for (const e of this.seen) {
      if (!best || e[1].n > best[1].n || (e[1].n === best[1].n && e[1].last > best[1].last)) best = e;
    }
    return best?.[0];
  }
}

class RowTally {
  calls = 0;
  completed = 0;
  missed = 0;
  durationSum = 0;
  durationN = 0;
  readonly callers = new Set<string>();
  readonly jobs = new Set<string>();
  readonly sources = new Votes();
  readonly names = new Votes();
  readonly flows = new Votes();

  add(call: TrackedCall): void {
    this.calls += 1;
    const cls = answerClassOf(call);
    if (cls === 'answered') {
      this.completed += 1;
      if (typeof call.durationSeconds === 'number' && Number.isFinite(call.durationSeconds)) {
        this.durationSum += call.durationSeconds;
        this.durationN += 1;
      }
    } else if (cls === 'missed') {
      this.missed += 1;
    }
    this.callers.add(call.from ?? '');
    const job = jobKeyOf(call);
    if (job) this.jobs.add(job);
    this.sources.add(call.sourceId, call.startedAt);
    this.names.add(call.flowName?.trim(), call.startedAt);
    this.flows.add(flowKeyOf(call), call.startedAt);
  }

  row(
    key: string,
    name: string,
    totals: ReadonlyMap<string, number>,
    extra: Partial<CallTrackingRow> = {},
  ): CallTrackingRow {
    let revenue = 0;
    for (const job of this.jobs) revenue += totals.get(job) ?? 0;
    const callers = this.callers.size;
    return {
      key,
      name,
      adGroupId: this.sources.winner(),
      ...extra,
      calls: this.calls,
      callers,
      completed: this.completed,
      missed: this.missed,
      avgDurationSeconds: this.durationN ? Math.round(this.durationSum / this.durationN) : 0,
      jobs: this.jobs.size,
      leads: 0,
      jobsConversionRate: callers ? round2((this.jobs.size / callers) * 100) : 0,
      leadsConversionRate: 0,
      revenue: round2(revenue),
    };
  }
}

/** What the report knows about a tracked number beyond its calls. */
export interface TrackedNumberInfo {
  phoneNumber: string;
  /** The number's own job-source setting (call attribution). */
  sourceId?: string;
}

/** A flow of the catalog: its current name and the numbers it answers. */
export interface TrackedFlowInfo {
  id: string;
  name: string;
  numbers?: string[];
}

/**
 * Everything the report needs from one walk of the call log, ready to serve
 * any grouping and any graph step — the unit the service caches.
 */
export interface CallTrackingSnapshot {
  from: string;
  to: string;
  /** Busiest first. */
  flows: CallTrackingRow[];
  /** Every known number, busiest first — the ones without calls at the end, at zero. */
  numbers: CallTrackingRow[];
  graphs: Record<CallTrackingGraphBy, CallTrackingGraph>;
  atLeast: boolean;
  computedAt: string;
}

const byBusiest = (a: CallTrackingRow, b: CallTrackingRow) =>
  b.calls - a.calls || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);

/**
 * Feeds on the calls of a window and turns them into a snapshot. Calls outside
 * the window (the walk reads whole index pages) and calls the report does not
 * count are dropped on the way in.
 */
export class CallTrackingTally {
  private readonly clock: AccountClock;
  private readonly flows = new Map<string, RowTally>();
  private readonly numbers = new Map<string, RowTally>();
  /** flow key → bucket → calls, one map per graph step. */
  private readonly graph: Record<CallTrackingGraphBy, Map<string, Map<string, number>>> = {
    hour: new Map(),
    day: new Map(),
    week: new Map(),
    month: new Map(),
  };
  private counted = 0;

  constructor(
    readonly window: { from: string; to: string; start: string; end: string },
    timeZone?: string,
  ) {
    this.clock = new AccountClock(timeZone);
  }

  /** How many calls were counted. */
  get size(): number {
    return this.counted;
  }

  add(call: TrackedCall): void {
    if (!isTrackedCall(call)) return;
    if (call.startedAt < this.window.start || call.startedAt >= this.window.end) return;
    this.counted += 1;

    const flow = flowKeyOf(call);
    let f = this.flows.get(flow);
    if (!f) this.flows.set(flow, (f = new RowTally()));
    f.add(call);

    const number = call.to ?? '';
    let n = this.numbers.get(number);
    if (!n) this.numbers.set(number, (n = new RowTally()));
    n.add(call);

    const local = this.clock.local(call.startedAt);
    const week = weekStartSunday(local.day);
    const buckets: Record<CallTrackingGraphBy, string> = {
      hour: String(local.hour).padStart(2, '0'),
      day: local.day,
      week: week < this.window.from ? this.window.from : week,
      month: local.month,
    };
    for (const step of CALL_TRACKING_GRAPH_BY) {
      let perFlow = this.graph[step].get(flow);
      if (!perFlow) this.graph[step].set(flow, (perFlow = new Map()));
      perFlow.set(buckets[step], (perFlow.get(buckets[step]) ?? 0) + 1);
    }
  }

  /** The deals the counted calls led to — whose totals make the revenue. */
  dealIds(): string[] {
    const out = new Set<string>();
    for (const t of this.flows.values()) {
      for (const job of t.jobs) if (!job.startsWith('workiz:')) out.add(job);
    }
    return [...out];
  }

  snapshot(input: {
    /** Deal id → the job's total. */
    totals: ReadonlyMap<string, number>;
    flowCatalog?: TrackedFlowInfo[];
    numbers?: TrackedNumberInfo[];
    atLeast?: boolean;
    computedAt?: string;
  }): CallTrackingSnapshot {
    const catalog = new Map((input.flowCatalog ?? []).map((f) => [f.id, f]));
    const flowName = (key: string, tally?: RowTally): string =>
      catalog.get(key)?.name?.trim() || tally?.names.winner() || (key.startsWith('name:') ? key.slice(5) : '');

    const flows = [...this.flows.entries()]
      .map(([key, t]) => t.row(key, flowName(key, t), input.totals))
      .sort(byBusiest);

    // Every number the account is known to hold: its settings, the flows'
    // numbers, and whatever took a call. Workiz lists all of them, zeros too.
    const settings = new Map((input.numbers ?? []).map((n) => [n.phoneNumber, n]));
    const flowOfNumber = new Map<string, TrackedFlowInfo>();
    for (const f of catalog.values()) for (const num of f.numbers ?? []) flowOfNumber.set(num, f);
    const known = new Set<string>([...settings.keys(), ...flowOfNumber.keys(), ...this.numbers.keys()]);
    known.delete('');
    const numbers = [...known].map((num) => {
      const t = this.numbers.get(num) ?? new RowTally();
      const flowKey = flowOfNumber.get(num)?.id ?? t.flows.winner();
      const row = t.row(num, formatTrackedNumber(num), input.totals, { number: num });
      const adGroupId = settings.get(num)?.sourceId ?? row.adGroupId;
      const fname = flowKey ? flowName(flowKey, this.flows.get(flowKey)) : '';
      return {
        ...row,
        ...(adGroupId ? { adGroupId } : { adGroupId: undefined }),
        ...(fname ? { flowName: fname } : {}),
      };
    });
    // Calls to no number at all (a record without `to`) still count in the cards.
    const blank = this.numbers.get('');
    if (blank) numbers.push(blank.row('', '', input.totals));
    numbers.sort(byBusiest);

    const graphs = {} as Record<CallTrackingGraphBy, CallTrackingGraph>;
    for (const step of CALL_TRACKING_GRAPH_BY) graphs[step] = this.graphFor(step, flows, (k) => flowName(k, this.flows.get(k)));

    return {
      from: this.window.from,
      to: this.window.to,
      flows,
      numbers: numbers.map(stripUndefined),
      graphs,
      atLeast: !!input.atLeast,
      computedAt: input.computedAt ?? new Date().toISOString(),
    };
  }

  private graphFor(
    step: CallTrackingGraphBy,
    flowsBusiest: CallTrackingRow[],
    nameOf: (key: string) => string,
  ): CallTrackingGraph {
    const buckets = bucketsOf(step, this.window.from, this.window.to);
    const index = new Map(buckets.map((b, i) => [b, i]));
    const counts = (key: string): number[] => {
      const out = buckets.map(() => 0);
      for (const [b, n] of this.graph[step].get(key) ?? []) {
        const i = index.get(b);
        if (i !== undefined) out[i] += n;
      }
      return out;
    };
    const top = flowsBusiest.slice(0, CALL_TRACKING_GRAPH_SERIES);
    const series = top.map((row) => ({ name: nameOf(row.key) || row.name, counts: counts(row.key) }));
    const rest = flowsBusiest.slice(CALL_TRACKING_GRAPH_SERIES);
    if (rest.length) {
      const other = buckets.map(() => 0);
      for (const row of rest) counts(row.key).forEach((n, i) => (other[i] += n));
      series.push({ name: CALL_TRACKING_OTHER_SERIES, counts: other });
    }
    return { graphBy: step, buckets, series };
  }
}

function stripUndefined<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as T;
}

/** The graph's x axis for a step over the window. */
export function bucketsOf(step: CallTrackingGraphBy, from: string, to: string): string[] {
  if (step === 'hour') return Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  const days = accountDaysBetween(from, to);
  if (step === 'day') return days;
  if (step === 'month') return [...new Set(days.map((d) => d.slice(0, 7)))];
  return [...new Set(days.map((d) => {
    const w = weekStartSunday(d);
    return w < from ? from : w;
  }))];
}

/** The seven cards, from the rows the way Workiz's page computes them. */
export function trackingCards(rows: CallTrackingRow[], groupBy: CallTrackingGroupBy): CallTrackingCards {
  // Workiz computes the cards from the rows its API sends — the ones with calls.
  const live = rows.filter((r) => r.calls > 0);
  const sum = (f: (r: CallTrackingRow) => number) => live.reduce((a, r) => a + f(r), 0);
  const mean = (f: (r: CallTrackingRow) => number) => (live.length ? sum(f) / live.length : 0);
  return {
    incomingCalls: sum((r) => r.calls),
    callers: sum((r) => r.callers),
    missedCalls: sum((r) => r.missed),
    topFlow: groupBy === 'flows' ? (live[0]?.name ?? null) : null,
    avgDurationSeconds: Math.round(mean((r) => r.avgDurationSeconds) * 100) / 100,
    conversion: round2(mean((r) => r.jobsConversionRate)),
    revenue: round2(sum((r) => r.revenue ?? 0)),
  };
}

/** One grouping and one graph step off a snapshot; money left out without `financials.view`. */
export function serveTracking(
  snapshot: CallTrackingSnapshot,
  opts: { groupBy: CallTrackingGroupBy; graphBy: CallTrackingGraphBy; withRevenue: boolean },
): CallTrackingReport {
  const rows = opts.groupBy === 'numbers' ? snapshot.numbers : snapshot.flows;
  const cards = trackingCards(rows, opts.groupBy);
  const noMoney = <T extends { revenue?: number }>(x: T): T => {
    if (opts.withRevenue) return x;
    const { revenue: _drop, ...rest } = x;
    return rest as T;
  };
  return {
    from: snapshot.from,
    to: snapshot.to,
    groupBy: opts.groupBy,
    graphBy: opts.graphBy,
    rows: rows.map(noMoney),
    cards: noMoney(cards),
    graph: snapshot.graphs[opts.graphBy],
    atLeast: snapshot.atLeast,
    computedAt: snapshot.computedAt,
  };
}
