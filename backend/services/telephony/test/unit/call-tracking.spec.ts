import {
  answerClassOf,
  bucketsOf,
  CallTrackingTally,
  flowKeyOf,
  formatTrackedNumber,
  jobKeyOf,
  serveTracking,
  trackingCards,
  type TrackedCall,
} from 'src/calls/tracking/call-tracking';
import { accountWindowUtc, type CallTrackingRow } from '@bitcrm/types';

/** 1–27 Sep 2026 on the account's clock — the period the live report was checked on. */
const WINDOW = { from: '2026-09-01', to: '2026-09-27', ...accountWindowUtc('2026-09-01', '2026-09-27') };

let seq = 0;
function call(over: Partial<TrackedCall> = {}): TrackedCall {
  seq += 1;
  return {
    callSid: `CA${seq}`,
    startedAt: '2026-09-10T15:00:00.000Z',
    direction: 'inbound',
    from: `+1555000${String(seq).padStart(4, '0')}`,
    to: '+12034036303',
    flowId: 'flow-ct',
    flowName: '(2-CT-O) SURE CT ORGANIC',
    externalId: `workiz:call:${seq}`,
    dialCallStatus: 'completed',
    status: 'completed',
    durationSeconds: 60,
    ...over,
  };
}

function tally(calls: TrackedCall[]) {
  const t = new CallTrackingTally(WINDOW);
  for (const c of calls) t.add(c);
  return t;
}

describe('Call Tracking — which calls are answered, missed or neither', () => {
  it("follows Workiz's dial status for an imported call", () => {
    expect(answerClassOf(call({ dialCallStatus: 'completed' }))).toBe('answered');
    // Nobody picked up: the dial status is empty.
    expect(answerClassOf(call({ dialCallStatus: undefined, status: 'no-answer' }))).toBe('missed');
    expect(answerClassOf(call({ dialCallStatus: 'no-answer', status: 'no-answer' }))).toBe('missed');
    // Busy, and the flow's voicemail box taking an unanswered call, are in
    // neither column — Workiz's 9,893 ≠ 8,554 + 1,335.
    expect(answerClassOf(call({ dialCallStatus: 'busy', status: 'busy' }))).toBe('neither');
    expect(answerClassOf(call({ dialCallStatus: undefined, voicemail: 2, status: 'no-answer' }))).toBe('neither');
    expect(answerClassOf(call({ dialCallStatus: undefined, voicemail: 1, status: 'no-answer' }))).toBe('missed');
  });

  it('reads our own calls by whether somebody picked up', () => {
    const native = { externalId: undefined, dialCallStatus: undefined };
    expect(answerClassOf(call({ ...native, status: 'completed', answeredAt: '2026-09-10T15:00:05.000Z' }))).toBe('answered');
    expect(answerClassOf(call({ ...native, status: 'canceled', answeredAt: undefined }))).toBe('missed');
    expect(answerClassOf(call({ ...native, status: 'no-answer', answeredAt: undefined }))).toBe('missed');
    // Still ringing — not missed yet.
    expect(answerClassOf(call({ ...native, status: 'ringing', answeredAt: undefined }))).toBe('neither');
  });
});

describe('Call Tracking — keys', () => {
  it('groups by the flow id, then Workiz’s flow id, then the name', () => {
    expect(flowKeyOf(call({ flowId: 'f1' }))).toBe('f1');
    expect(flowKeyOf(call({ flowId: undefined, workizFlowId: '180382' }))).toBe('workiz:180382');
    expect(flowKeyOf(call({ flowId: undefined, workizFlowId: undefined, flowName: ' Main line ' }))).toBe('name:Main line');
    expect(flowKeyOf(call({ flowId: undefined, workizFlowId: undefined, flowName: undefined }))).toBe('none');
  });

  it('counts a job by its deal, or by Workiz’s id when it never became a deal', () => {
    expect(jobKeyOf(call({ dealId: 'd1', workizJobId: '64199003' }))).toBe('d1');
    expect(jobKeyOf(call({ dealId: undefined, workizJobId: '64199003' }))).toBe('workiz:64199003');
    expect(jobKeyOf(call({ dealId: undefined, workizJobId: undefined }))).toBeUndefined();
  });

  it('prints a US number the way the account does', () => {
    expect(formatTrackedNumber('+12034036303')).toBe('(203) 403-6303');
    expect(formatTrackedNumber('+442071234567')).toBe('+442071234567');
  });
});

describe('Call Tracking — the tally', () => {
  it('counts inbound calls inside the window only, never the internal leg', () => {
    const t = tally([
      call(),
      call({ direction: 'outbound' }),
      call({ internalLegOf: 'CA0' }),
      // 23:59 Eastern on Aug 31 — the day before the window.
      call({ startedAt: '2026-09-01T03:59:59.000Z' }),
      // 00:00 Eastern on Sep 1 — the window's first instant.
      call({ startedAt: '2026-09-01T04:00:00.000Z' }),
      // 00:00 Eastern on Sep 28 — just past the window.
      call({ startedAt: '2026-09-28T04:00:00.000Z' }),
    ]);
    expect(t.size).toBe(2);
  });

  it('counts callers per row, so the number view sums higher than the flow view', () => {
    const caller = '+15550001111';
    const snap = tally([
      call({ from: caller, to: '+12030000001' }),
      call({ from: caller, to: '+12030000002' }),
    ]).snapshot({ totals: new Map() });
    expect(trackingCards(snap.flows, 'flows').callers).toBe(1);
    expect(trackingCards(snap.numbers, 'numbers').callers).toBe(2);
  });

  it('counts distinct jobs of any status and sums the deals’ totals as revenue', () => {
    const snap = tally([
      call({ dealId: 'd1' }),
      call({ dealId: 'd1' }),
      call({ dealId: 'd2' }),
      // A Workiz job that is not a deal here: a job, no money.
      call({ dealId: undefined, workizJobId: '999' }),
      call({ dealId: undefined, workizJobId: undefined }),
    ]).snapshot({ totals: new Map([['d1', 100.1], ['d2', 50.25]]) });
    const [row] = snap.flows;
    expect(row.calls).toBe(5);
    expect(row.jobs).toBe(3);
    expect(row.revenue).toBe(150.35);
    expect(row.jobsConversionRate).toBe(60);
  });

  it('splits answered, missed and neither', () => {
    const snap = tally([
      call({ dialCallStatus: 'completed', durationSeconds: 100 }),
      call({ dialCallStatus: 'completed', durationSeconds: 51 }),
      call({ dialCallStatus: undefined, durationSeconds: 0 }),
      call({ dialCallStatus: 'busy', durationSeconds: 0 }),
    ]).snapshot({ totals: new Map() });
    const [row] = snap.flows;
    expect(row).toMatchObject({ calls: 4, completed: 2, missed: 1, avgDurationSeconds: 75 });
  });

  it("averages Workiz's way: all the row's talk time over its answered calls, rounded down", () => {
    // "UP & DOWN GARAGE DOORS TX", 1–27 Sep 2026: four voicemails and one answered
    // call of 6 s — Workiz shows 00:07:22 (442 s) for it.
    const snap = tally([
      call({ dialCallStatus: undefined, voicemail: 2, durationSeconds: 215 }),
      call({ dialCallStatus: undefined, voicemail: 2, durationSeconds: 208 }),
      call({ dialCallStatus: undefined, voicemail: 2, durationSeconds: 6 }),
      call({ dialCallStatus: undefined, voicemail: 2, durationSeconds: 7 }),
      call({ dialCallStatus: 'completed', durationSeconds: 6 }),
    ]).snapshot({ totals: new Map() });
    // …and Workiz calls none of those voicemails missed.
    expect(snap.flows[0]).toMatchObject({ calls: 5, completed: 1, missed: 0, avgDurationSeconds: 442 });
    // Nobody answered: 0, whatever the voicemails ran to.
    const none = tally([call({ dialCallStatus: undefined, durationSeconds: 90 })]).snapshot({ totals: new Map() });
    expect(none.flows[0].avgDurationSeconds).toBe(0);
  });

  it('orders rows busiest first and names flows by the catalog', () => {
    const snap = tally([
      call({ flowId: 'a', flowName: 'Old name' }),
      call({ flowId: 'b', flowName: 'B' }),
      call({ flowId: 'b', flowName: 'B' }),
    ]).snapshot({ totals: new Map(), flowCatalog: [{ id: 'a', name: 'Renamed A' }] });
    expect(snap.flows.map((r) => [r.key, r.name, r.calls])).toEqual([
      ['b', 'B', 2],
      ['a', 'Renamed A', 1],
    ]);
  });

  it('lists every known number in the number view, zeros included', () => {
    const snap = tally([call({ to: '+12034036303', sourceId: 'src-call' })]).snapshot({
      totals: new Map(),
      numbers: [
        { phoneNumber: '+12034036303', sourceId: 'src-number' },
        { phoneNumber: '+18889770000' },
      ],
      flowCatalog: [{ id: 'flow-ct', name: 'SURE CT', numbers: ['+12034036303', '+12030009999'] }],
    });
    expect(snap.numbers.map((r) => [r.number, r.calls])).toEqual([
      ['+12034036303', 1],
      ['+12030009999', 0],
      ['+18889770000', 0],
    ]);
    // The number's own attribution wins over what its calls were stamped with.
    expect(snap.numbers[0]).toMatchObject({ name: '(203) 403-6303', adGroupId: 'src-number', flowName: 'SURE CT' });
    // …and the cards count only the rows with calls, as Workiz's page does.
    expect(trackingCards(snap.numbers, 'numbers').avgDurationSeconds).toBe(60);
  });

  it('attributes a flow to the job source most of its calls came in on', () => {
    const snap = tally([
      call({ sourceId: 'google' }),
      call({ sourceId: 'google' }),
      call({ sourceId: 'yelp', startedAt: '2026-09-20T15:00:00.000Z' }),
    ]).snapshot({ totals: new Map() });
    expect(snap.flows[0].adGroupId).toBe('google');
  });

  it('lists the deals whose totals it needs — not the Workiz-only jobs', () => {
    const t = tally([call({ dealId: 'd1' }), call({ dealId: undefined, workizJobId: '7' })]);
    expect(t.dealIds()).toEqual(['d1']);
  });
});

describe('Call Tracking — the cards', () => {
  const row = (over: Partial<CallTrackingRow>): CallTrackingRow => ({
    key: over.name ?? 'k',
    name: 'Flow',
    calls: 1,
    callers: 1,
    completed: 1,
    missed: 0,
    avgDurationSeconds: 0,
    jobs: 0,
    leads: 0,
    jobsConversionRate: 0,
    leadsConversionRate: 0,
    revenue: 0,
    ...over,
  });

  it('sums the counts, means the durations and conversions over the rows, and tops with the first row', () => {
    // Three rows off the live 1–27 Sep answer (by flow).
    const rows = [
      row({ name: '(2-CT-O) SURE CT ORGANIC', calls: 1384, callers: 605, missed: 190, avgDurationSeconds: 146, jobs: 72, jobsConversionRate: 11.9, revenue: 6245.47 }),
      row({ name: 'Mid', calls: 10, callers: 4, missed: 1, avgDurationSeconds: 30, jobs: 2, jobsConversionRate: 50, revenue: 100 }),
      row({ name: 'Forward to Riley CSR', calls: 1, callers: 1, missed: 1, avgDurationSeconds: 0, jobs: 0, jobsConversionRate: 0, revenue: 0 }),
    ];
    expect(trackingCards(rows, 'flows')).toEqual({
      incomingCalls: 1395,
      callers: 610,
      missedCalls: 192,
      topFlow: '(2-CT-O) SURE CT ORGANIC',
      // (146 + 30 + 0) / 3 — the zero row counts, as in Workiz.
      avgDurationSeconds: 58.67,
      conversion: 20.63,
      revenue: 6345.47,
    });
    expect(trackingCards(rows, 'numbers').topFlow).toBeNull();
  });

  it('serves one grouping and graph step, and leaves money out without financials', () => {
    const snap = tally([call({ dealId: 'd1' })]).snapshot({ totals: new Map([['d1', 10]]) });
    const withMoney = serveTracking(snap, { groupBy: 'flows', graphBy: 'day', withRevenue: true });
    expect(withMoney.cards.revenue).toBe(10);
    expect(withMoney.rows[0].revenue).toBe(10);
    expect(withMoney.graph.graphBy).toBe('day');

    const without = serveTracking(snap, { groupBy: 'numbers', graphBy: 'hour', withRevenue: false });
    expect(without.cards).not.toHaveProperty('revenue');
    expect(without.rows[0]).not.toHaveProperty('revenue');
    expect(without.groupBy).toBe('numbers');
  });
});

describe('Call Tracking — the graph', () => {
  it('buckets by the account’s hour, day, week of the month and month', () => {
    expect(bucketsOf('hour', '2026-09-01', '2026-09-27')).toHaveLength(24);
    expect(bucketsOf('day', '2026-09-01', '2026-09-27')).toHaveLength(27);
    // Workiz's "week 1  In Sep" is the 1st–7th, "week 2" the 8th–14th… —
    // weeks of the month, whatever weekday the month starts on
    // (rep_calltracking_wz_04_graph_week: Oct 1–7 and Oct 8–9 of 2026).
    expect(bucketsOf('week', '2026-09-01', '2026-09-27')).toEqual([
      '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22',
    ]);
    // A window across two months: the 29th–30th is a week of its own.
    expect(bucketsOf('week', '2026-09-10', '2026-10-09')).toEqual([
      '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-01', '2026-10-08',
    ]);
    expect(bucketsOf('month', '2026-08-15', '2026-09-27')).toEqual(['2026-08', '2026-09']);
  });

  it('counts a call into its week of the month', () => {
    // Sep 7, 8 and 14 at noon in New York (16:00 UTC): weeks 1, 2 and 2.
    const snap = tally([
      call({ startedAt: '2026-09-07T16:00:00.000Z' }),
      call({ startedAt: '2026-09-08T16:00:00.000Z' }),
      call({ startedAt: '2026-09-14T16:00:00.000Z' }),
    ]).snapshot({ totals: new Map() });
    expect(snap.graphs.week.buckets).toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22']);
    expect(snap.graphs.week.series[0].counts).toEqual([1, 2, 0, 0]);
  });

  it('draws the hundred busiest flows, one line each, and leaves the rest out — as Workiz does', () => {
    const calls: TrackedCall[] = [];
    for (let f = 0; f < 103; f += 1) {
      for (let i = 0; i <= f; i += 1) {
        // 10:30 Eastern (14:30 UTC in September).
        calls.push(call({ flowId: `f${f}`, flowName: `Flow ${f}`, startedAt: '2026-09-02T14:30:00.000Z' }));
      }
    }
    const snap = tally(calls).snapshot({ totals: new Map() });
    const hour = snap.graphs.hour;
    expect(hour.series).toHaveLength(100);
    // Busiest first; Flows 0–2, the three quietest, are not drawn, and no
    // "Other flows" line sums them (Workiz's graph had 100 of 103 flows).
    expect(hour.series[0].name).toBe('Flow 102');
    expect(hour.series.at(-1)?.name).toBe('Flow 3');
    expect(hour.series.map((s) => s.name)).not.toContain('Other flows');
    expect(hour.series[0].counts[10]).toBe(103);
    expect(snap.graphs.day.series[0].counts[1]).toBe(103);
  });
});
