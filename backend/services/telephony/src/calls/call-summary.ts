import { answerClassOf, jobKeyOf, type TrackedCall } from './tracking/call-tracking';

/**
 * The stat cards over the call log — Workiz's `aggs` beside the rows of
 * "Workiz Phone" (`/node-voice/calls/report/`: calls, callers, missed_calls,
 * active, revenue). No I/O here; the walk (`CallsRepository.walkSelection`)
 * feeds it the rows the log's filters select, projected to
 * {@link SUMMARY_ATTRIBUTES}.
 *
 *  - calls   = every row the filter selects — the table's "of N";
 *  - callers = distinct OUTSIDE numbers: the `from` of an inbound call, the
 *              `to` of an outbound one (a browser leg is not a number);
 *  - missed  = inbound calls the Call Tracking report counts as missed
 *              (`answerClassOf`), so the card and that report agree;
 *  - active  = calls still going;
 *  - jobs    = distinct linked jobs, a Workiz job that never became a deal
 *              included (`jobKeyOf`), whatever the job's status;
 *  - revenue = Σ the totals of the distinct linked DEALS — only when the
 *              totals were asked for (`financials.view`), never a guessed 0.
 */
export interface CallsSummary {
  calls: number;
  callers: number;
  missed: number;
  active: number;
  jobs: number;
  /** Absent without `financials.view`, or when deal-service could not say. */
  revenue?: number;
  /** The walk stopped on its read budget: every number is a floor. */
  atLeast: boolean;
}

/** The attributes the rules read off a call row — what the walk projects. */
export type SummaryCall = TrackedCall;

export const SUMMARY_ATTRIBUTES: (keyof SummaryCall)[] = [
  'callSid',
  'startedAt',
  'direction',
  'from',
  'to',
  'status',
  'answeredAt',
  'dealId',
  'workizJobId',
  'externalId',
  'dialCallStatus',
  'voicemail',
];

const LIVE = new Set(['queued', 'initiated', 'ringing', 'in-progress']);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The far side of a call — the number that is not ours. */
function outsideNumber(call: SummaryCall): string | undefined {
  const n = call.direction === 'inbound' ? call.from : call.direction === 'outbound' ? call.to : undefined;
  // `client:<id>` is an agent's browser leg (legacy rows), not anyone's number.
  return n && !n.startsWith('client:') ? n : undefined;
}

export class CallsSummaryTally {
  private calls = 0;
  private missed = 0;
  private active = 0;
  private readonly callers = new Set<string>();
  private readonly jobs = new Set<string>();

  add(call: SummaryCall): void {
    this.calls += 1;
    const outside = outsideNumber(call);
    if (outside) this.callers.add(outside);
    if (call.status && LIVE.has(call.status)) this.active += 1;
    if (call.direction === 'inbound' && answerClassOf(call) === 'missed') this.missed += 1;
    const job = jobKeyOf(call);
    if (job) this.jobs.add(job);
  }

  /** The deals whose totals make the revenue — Workiz job ids have none here. */
  dealIds(): string[] {
    return [...this.jobs].filter((job) => !job.startsWith('workiz:'));
  }

  result(input: { atLeast: boolean; totals?: ReadonlyMap<string, number> }): CallsSummary {
    const out: CallsSummary = {
      calls: this.calls,
      callers: this.callers.size,
      missed: this.missed,
      active: this.active,
      jobs: this.jobs.size,
      atLeast: input.atLeast,
    };
    if (input.totals) {
      let revenue = 0;
      for (const id of this.dealIds()) revenue += input.totals.get(id) ?? 0;
      out.revenue = round2(revenue);
    }
    return out;
  }
}
