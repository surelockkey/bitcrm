import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  SnsPublisherService, BusinessMetricsService,
  RedisService,
  cachedCount,
  countCacheKey,
  type CountRowsResult,
} from '@bitcrm/shared';
import {
  CALL_TAG_LIMITS,
  CallEventType,
  DASHBOARD_RANGES,
  dashboardWindow,
  type CallFlowSeries,
  type ListCount,
} from '@bitcrm/types';
import {
  CallsRepository,
  CallTagsConflictError,
  type CallRecord,
  type CallStatus,
  type ListCallsFilter,
  type UpsertOutcome,
} from './calls.repository';
import { CallCountersRepository, monthFullyCovered } from './call-counters.repository';
import { CallFinalizer } from './call-finalizer';
import { RecordingArchiveService } from './recording-archive.service';
import { monthsDescending } from '../common/constants/dynamo.constants';
import { CallEventsBus } from './call-events.bus';
import { DealLinkService } from '../common/deal-link.service';
import { NumberSettingsRepository } from '../numbers/number-settings.repository';
import { CallFlowsService } from '../call-flows/call-flows.service';
import { CallTagsService } from '../call-tags/call-tags.service';
import { callFlowSeries } from './call-flow-series';
import { CallsSummaryTally, SUMMARY_ATTRIBUTES, type CallsSummary, type SummaryCall } from './call-summary';
import { DealTotalsClient } from '../common/deal-totals.client';
import { StoredDealTotals } from './stored-deal-totals';

/** What `PATCH /calls/:sid/tags` carries: ids to put on, ids to take off. */
export interface CallTagsChange {
  add?: string[];
  remove?: string[];
}

/** Distinct, non-empty strings, in first-seen order. */
function uniqueIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v.trim() && !out.includes(v)) out.push(v);
  }
  return out;
}

/** How many times a tag write is retried when somebody else got there first. */
const TAG_WRITE_ATTEMPTS = 3;

/** Raw form params Twilio POSTs to the status callback (subset we use). */
export interface TwilioStatusParams {
  CallSid?: string;
  CallStatus?: string;
  From?: string;
  To?: string;
  Direction?: string;
  CallDuration?: string;
  Timestamp?: string;
  /** The carrier's SIP answer on an ended leg (486 busy, 480 unavailable…). */
  SipResponseCode?: string;
  /** Twilio's error code when it refused or lost the leg (13227, 21215…). */
  ErrorCode?: string;
  /**
   * Answering-machine detection's verdict on a leg placed with
   * `machineDetection` (the technician's handset on a masked call): `human`,
   * `unknown`, `machine_start`, `machine_end_*`, `fax`.
   */
  AnsweredBy?: string;
}

/** `client:abc-123` → `abc-123`; anything else → undefined. */
export function agentFromEndpoint(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  const m = /^client:(.+)$/.exec(endpoint);
  return m ? m[1] : undefined;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'initiated', 'ringing', 'in-progress',
  'completed', 'busy', 'no-answer', 'failed', 'canceled',
]);

/** Twilio call statuses map 1:1 onto ours; anything unknown is dropped. */
export function normalizeStatus(raw?: string): CallStatus | undefined {
  return raw && KNOWN_STATUSES.has(raw) ? (raw as CallStatus) : undefined;
}

/** Twilio directions (`inbound`, `outbound-api`, `outbound-dial`) → ours. */
export function normalizeDirection(
  raw?: string,
): 'inbound' | 'outbound' | undefined {
  if (!raw) return undefined;
  if (raw === 'inbound') return 'inbound';
  if (raw.startsWith('outbound')) return 'outbound';
  return undefined;
}

/**
 * Lifecycle ordering: statuses only ever move forward. All terminal states
 * share one rank — the first terminal to land wins, later ones are dropped
 * (webhooks arrive out of order).
 */
const STATUS_RANK: Record<CallStatus, number> = {
  queued: 0,
  initiated: 1,
  ringing: 2,
  'in-progress': 3,
  completed: 4,
  busy: 4,
  'no-answer': 4,
  failed: 4,
  canceled: 4,
  blocked: 4,
};

export function statusRank(status: CallStatus): number {
  return STATUS_RANK[status];
}

/** Nothing follows these — the call is over. */
export function isTerminalStatus(status?: CallStatus): boolean {
  return !!status && STATUS_RANK[status] === 4;
}

/** A partial lifecycle update; callSid is the only required field. */
export type LifecycleUpdate = Partial<CallRecord> & { callSid: string };

/** How long a list count stays good enough. Matches the deals tab counts. */
const COUNT_TTL_SECONDS = 30;
/** The longest "Top Call Flows" window — the same quarter every report is held to. */
const FLOW_WINDOW_MAX_DAYS = 92;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A "Top Call Flows" snapshot lives until the next nightly run, with slack. */
const FLOW_SNAPSHOT_TTL_SECONDS = 26 * 3600;

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly repo: CallsRepository,
    @Optional() private readonly bus?: CallEventsBus,
    @Optional() private readonly dealLinks?: DealLinkService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly numberSettings?: NumberSettingsRepository,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    /**
     * Deliberately NOT @Optional: the catalog is what keeps `tagIds` a set of
     * ids something can name. If CallTagsModule ever leaves CallsModule's
     * imports, Nest must refuse to build this service rather than inject
     * `undefined` and let the route write any string onto a call. The type
     * stays optional only so unit tests can construct the service with the
     * collaborators a case actually needs; updateTags refuses when it is.
     */
    private readonly callTags?: CallTagsService,
    @Optional() private readonly callFlows?: CallFlowsService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly dealTotals?: DealTotalsClient,
    /** Names, freezes and lists a call once it has ended (write path). */
    @Optional() private readonly finalizer?: CallFinalizer,
    /** Per-month call counters (`CALLCOUNT`) behind the unfiltered count. */
    @Optional() private readonly counters?: CallCountersRepository,
    /** Copies a finished recording from Twilio into our bucket. */
    @Optional() private readonly recordings?: RecordingArchiveService,
  ) {}

  /**
   * Move the month counters on the two transitions `upsert` reports: a row
   * entering the log (+1, unless it is a hidden internal leg) and a counted
   * row turning out to be one (−1). Fire-and-forget: a counter is never worth
   * failing a call write for; `recount:calls` corrects any drift.
   */
  private countWrite(outcome: UpsertOutcome | undefined, record: CallRecord): void {
    if (!this.counters || !outcome) return;
    let month: string | undefined;
    let delta = 0;
    if (outcome.created && !record.internalLegOf) {
      month = record.startedAt.slice(0, 7);
      delta = 1;
    } else if (outcome.becameInternal) {
      month = (outcome.startedAt ?? record.startedAt).slice(0, 7);
      delta = -1;
    }
    if (!month || !delta) return;
    this.counters
      .bump(month, delta)
      .catch((err) =>
        this.logger.warn(`Call counter ${month} ${delta > 0 ? '+' : ''}${delta} lost: ${err instanceof Error ? err.message : err}`),
      );
  }

  /**
   * Call-tracking attribution: the tracked number a call came through
   * (inbound → the number dialed, outbound → our caller id) decides its job
   * source and its company. Company precedence: the number's own setting →
   * the flow that answers that number → none. Each field is resolved only
   * while the record lacks it — a number reassigned later must not rewrite
   * settled history — and a lookup failure never fails the call write.
   */
  private async resolveAttribution(
    update: LifecycleUpdate,
    existing: CallRecord | null,
    want: { source: boolean; company: boolean },
  ): Promise<{ sourceId?: string; businessProfileId?: string }> {
    const direction = update.direction ?? existing?.direction;
    const tracked =
      direction === 'inbound'
        ? (update.to ?? existing?.to)
        : direction === 'outbound'
          ? (update.from ?? existing?.from)
          : undefined;
    if (!tracked) return {};

    let settings: { sourceId?: string; businessProfileId?: string } | null = null;
    if (this.numberSettings) {
      try {
        settings = await this.numberSettings.get(tracked);
      } catch (err) {
        this.logger.warn(
          `Number settings lookup for ${tracked} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    let businessProfileId = want.company ? settings?.businessProfileId : undefined;
    if (want.company && !businessProfileId && this.callFlows) {
      try {
        businessProfileId = (await this.callFlows.findByNumber(tracked))?.businessProfileId;
      } catch (err) {
        this.logger.warn(
          `Flow lookup for ${tracked} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return {
      sourceId: want.source ? settings?.sourceId : undefined,
      businessProfileId: businessProfileId || undefined,
    };
  }

  /** Fire-and-forget SNS publish — event failures never fail a call write. */
  private publishSns(eventType: string, payload: Record<string, unknown>): void {
    this.snsPublisher
      ?.publish('call-events', eventType, payload)
      .catch((err) =>
        this.logger.warn(
          `SNS publish ${eventType} failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
  }

  /**
   * The single record-writer for the conference lifecycle. Merges the update
   * onto the stored record with a monotonic status guard (terminal never
   * regresses to live; first terminal wins) and derives talk time once both
   * answeredAt and endedAt are known. Returns the record as persisted.
   */
  async applyLifecycle(
    update: LifecycleUpdate,
    now: string = new Date().toISOString(),
  ): Promise<CallRecord> {
    const existing = await this.repo.getBySid(update.callSid);

    let status = update.status;
    if (
      status &&
      existing?.status &&
      statusRank(status) <= statusRank(existing.status)
    ) {
      status = undefined; // out-of-order webhook — keep the stored status
    }

    const answeredAt = update.answeredAt ?? existing?.answeredAt;
    const endedAt = update.endedAt ?? existing?.endedAt;
    let durationSeconds = update.durationSeconds;
    if (durationSeconds === undefined && answeredAt && endedAt) {
      durationSeconds = Math.max(
        0,
        Math.round(
          (new Date(endedAt).getTime() - new Date(answeredAt).getTime()) / 1000,
        ),
      );
    }

    // Guarded before the await: without a settings repo / flows (or with the
    // source and company already settled) the write path keeps its exact microtask profile —
    // fire-and-forget callers (the stale-live heal) rely on it landing fast.
    const needSource =
      !update.sourceId && !existing?.sourceId && !!this.numberSettings;
    const needCompany =
      !update.businessProfileId &&
      !existing?.businessProfileId &&
      (!!this.numberSettings || !!this.callFlows);
    const attribution =
      needSource || needCompany
        ? await this.resolveAttribution(update, existing, {
            source: needSource,
            company: needCompany,
          })
        : {};
    const record: CallRecord = {
      ...update,
      status,
      durationSeconds,
      sourceId: update.sourceId ?? attribution.sourceId,
      businessProfileId: update.businessProfileId ?? attribution.businessProfileId,
      startedAt: update.startedAt ?? existing?.startedAt ?? now,
      updatedAt: now,
    };
    this.countWrite(await this.repo.upsert(record), record);
    const merged: CallRecord = {
      ...existing,
      ...record,
      status: status ?? existing?.status,
    };

    // Live UI push (SSE) — every persisted change, except hidden internal
    // receiving legs (they'd surface a second row for one internal call).
    if (!merged.internalLegOf) {
      this.bus?.publish({ type: 'call.upserted', call: merged });
    }

    // Cross-service events — only on the interesting transitions.
    if (update.answeredAt && !existing?.answeredAt) {
      this.businessMetrics?.callsAnswered.inc({
        direction: merged.direction ?? 'unknown',
      });
      this.publishSns(CallEventType.CALL_STARTED, {
        callSid: merged.callSid,
        direction: merged.direction,
        from: merged.from,
        to: merged.to,
        agentId: merged.agentId,
        answeredAt: update.answeredAt,
      });
    }
    if (status && statusRank(status) === 4 && existing?.status !== status) {
      // Name, freeze and list the call — once, off the webhook's path.
      if (!merged.internalLegOf) this.finalizer?.schedule(merged.callSid);
      const direction = merged.direction ?? 'unknown';
      this.businessMetrics?.callsCompleted.inc({ direction, status });
      if (merged.durationSeconds !== undefined) {
        this.businessMetrics?.callDuration.observe(
          { direction },
          merged.durationSeconds,
        );
      }
      this.publishSns(CallEventType.CALL_COMPLETED, {
        callSid: merged.callSid,
        direction: merged.direction,
        from: merged.from,
        to: merged.to,
        agentId: merged.agentId,
        status,
        durationSeconds: merged.durationSeconds,
        startedAt: merged.startedAt,
        endedAt: merged.endedAt,
      });
    }
    if (update.recordingSid && !existing?.recordingSid) {
      // Copy the audio into our bucket in the background (webhook queue).
      if (!merged.recordingKey) this.recordings?.schedule(merged.callSid, update.recordingSid);
      this.bus?.publish({ type: 'call.recording_ready', call: merged });
      this.publishSns(CallEventType.CALL_RECORDING_READY, {
        callSid: merged.callSid,
        recordingSid: update.recordingSid,
        recordingDurationSeconds: merged.recordingDurationSeconds,
      });
    }
    return merged;
  }

  /**
   * A person correcting who a call was with. Overwrites whatever automatic
   * resolution decided and marks the record so it is never re-derived — and
   * rewrites the Search box's names to match (best effort).
   */
  async setPartiesManually(
    callSid: string,
    parties: Parameters<CallsRepository['setParties']>[1],
    startedAt: string,
  ): Promise<void> {
    await this.repo.setParties(callSid, parties, startedAt, 'manual');
    await this.finalizer?.restampNames(callSid).catch((err) =>
      this.logger.warn(`Call ${callSid}: search names not restamped: ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * The live call the given user is on, if any — the browser knows its own
   * Twilio leg, but for an inbound call that leg is a child of the record, so
   * the server is the one that can answer this.
   */
  async activeCallFor(userId: string): Promise<CallRecord | null> {
    const live = await this.listLive();
    return (
      live.find(
        (call) =>
          call.agentId === userId ||
          call.participants?.some((p) => p.userId === userId),
      ) ?? null
    );
  }

  /** Record one step of the caller's journey through a call flow. */
  async recordFlowStep(
    callSid: string,
    step: { nodeId: string; type: string; detail?: string },
  ): Promise<void> {
    await this.repo
      .appendFlowStep(callSid, { ...step, at: new Date().toISOString() })
      .catch(() => undefined);
  }

  /** Attach a call to a job, or detach it, and tell the job about it. */
  async linkDeal(
    callSid: string,
    dealId: string | null,
    actor: { id: string; name?: string },
  ): Promise<CallRecord | null> {
    const before = await this.repo.getBySid(callSid);
    if (!before) return null;

    await this.repo.setDeal(callSid, dealId, actor.id);
    await this.reindexDealLink(callSid, before.dealId, dealId);
    const after = await this.repo.getBySid(callSid);
    // The job's total rides on the call for the reports — read after the
    // answer, best effort: a failure leaves it unset, and the reports ask
    // deal-service for exactly the rows that carry none.
    if (dealId) void this.stampDealTotal(callSid, dealId);

    // The job's activity feed is the other half of the link. Best-effort: a
    // deal-service hiccup must not lose the link itself.
    void this.dealLinks
      ?.record(dealId ?? (before.dealId as string), {
        callSid,
        linked: !!dealId,
        actorId: actor.id,
        actorName: actor.name,
        details: {
          callSid,
          direction: before.direction,
          from: before.from,
          to: before.to,
          startedAt: before.startedAt,
          durationSeconds: before.durationSeconds,
          hasRecording: !!before.recordingSid,
        },
      })
      .catch(() => undefined);

    if (after && !after.internalLegOf) {
      this.bus?.publish({ type: 'call.upserted', call: after });
    }
    return after;
  }

  /**
   * Keep the `DEALCALLS#<dealId>` adjacency in step with the link. Never fails
   * the link: a missing row only means deal-events skip this call until the
   * next link change or `backfill:call-deal-totals`.
   */
  private async reindexDealLink(
    callSid: string,
    previous: string | undefined,
    next: string | null,
  ): Promise<void> {
    try {
      if (previous && previous !== next) await this.repo.unindexDealLink(previous, callSid);
      if (next) await this.repo.indexDealLink(next, callSid);
    } catch (err) {
      this.logger.warn(
        `Call ${callSid}: job index not updated (${previous ?? '-'} → ${next ?? '-'}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Read one job's total and stamp it on one call. Never throws. */
  async stampDealTotal(callSid: string, dealId: string): Promise<void> {
    if (!this.dealTotals) return;
    try {
      const total = await this.dealTotals.totalOf(dealId);
      await this.repo.setDealTotal(callSid, dealId, total, new Date().toISOString());
    } catch (err) {
      this.logger.warn(
        `Call ${callSid}: total of job ${dealId} not stamped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * A deal-event said job `dealId` may have a new total: read it once and
   * restamp every call filed under the job. Returns how many calls are filed.
   * Throws when deal-service cannot answer, so the SQS message is retried.
   */
  async refreshDealTotals(dealId: string): Promise<number> {
    const sids = await this.repo.callSidsForDeal(dealId);
    if (!sids.length || !this.dealTotals) return sids.length;
    const total = await this.dealTotals.totalOf(dealId);
    const at = new Date().toISOString();
    await Promise.all(sids.map((sid) => this.repo.setDealTotal(sid, dealId, total, at)));
    return sids.length;
  }

  /**
   * Put call tags on a call, or take them off — the Workiz "Tags" column.
   *
   * Ids being added are checked against the catalog (unknown → 404, archived
   * → 400: an archived tag has left the pickers and must not creep back in
   * through the API); ids being removed are not, so a tag that has since been
   * archived can still come off. The write is a compare-and-set on the stored
   * list, retried on a race. Returns the record as persisted, or null for an
   * unknown call.
   */
  async updateTags(
    callSid: string,
    change: CallTagsChange,
    actor: { id: string },
  ): Promise<CallRecord | null> {
    const add = uniqueIds(change?.add);
    const remove = uniqueIds(change?.remove);
    if (!add.length && !remove.length) {
      throw new BadRequestException('Nothing to change — pass add and/or remove');
    }

    if (add.length) {
      if (!this.callTags) {
        // Unreachable through DI — and if it is ever reached, refusing is the
        // only safe answer: an unvalidated id would put a tag on the call that
        // nothing can name and no picker can take off.
        throw new InternalServerErrorException(
          'Call-tag catalog unavailable — cannot validate tags',
        );
      }
      let catalog = await this.callTags.byId();
      // A tag the picker created seconds ago may be missing from this task's
      // memoised catalog: a write clears the cache only on the task that
      // served it, and there are always at least two during a rolling deploy.
      // Re-read once before calling an id unknown — create-then-attach is a
      // single gesture in the UI, and a 404 there reverts the chip with no
      // explanation the dispatcher can act on.
      if (add.some((id) => !catalog.has(id))) {
        catalog = await this.callTags.byId({ refresh: true });
      }
      for (const id of add) {
        const tag = catalog.get(id);
        if (!tag) throw new NotFoundException(`Call tag ${id} not found`);
        if (!tag.active) {
          throw new BadRequestException(
            `"${tag.name}" is archived — restore it in Settings before tagging calls with it`,
          );
        }
      }
    }

    for (let attempt = 1; ; attempt++) {
      const before = await this.repo.getBySid(callSid);
      if (!before) return null;

      const current = before.tagIds ?? [];
      const next = [
        ...current.filter((id) => !remove.includes(id)),
        ...add.filter((id) => !current.includes(id)),
      ];
      if (next.length > CALL_TAG_LIMITS.maxPerCall) {
        throw new BadRequestException(
          `A call can carry at most ${CALL_TAG_LIMITS.maxPerCall} tags`,
        );
      }
      // Already in the requested state — nothing to write, nothing to announce.
      if (next.length === current.length && next.every((id, i) => id === current[i])) {
        return before;
      }

      try {
        await this.repo.setTags(callSid, next, before.tagIds);
      } catch (error) {
        if (error instanceof CallTagsConflictError && attempt < TAG_WRITE_ATTEMPTS) {
          continue;
        }
        throw error;
      }

      const after = (await this.repo.getBySid(callSid)) ?? {
        ...before,
        tagIds: next.length ? next : undefined,
      };
      if (!after.internalLegOf) {
        this.bus?.publish({ type: 'call.upserted', call: after });
      }
      this.publishSns(CallEventType.CALL_UPDATED, {
        callSid,
        tagIds: next,
        actorId: actor.id,
        updatedAt: after.updatedAt,
      });
      this.logger.log(
        `Call ${callSid}: tags ${next.length ? next.join(', ') : '(none)'} by ${actor.id}`,
      );
      return after;
    }
  }

  getBySid(callSid: string) {
    return this.repo.getBySid(callSid);
  }

  appendChildSid(callSid: string, childSid: string) {
    return this.repo.appendChildSid(callSid, childSid);
  }

  async appendParticipant(
    callSid: string,
    participant: Parameters<CallsRepository['appendParticipant']>[1],
  ) {
    await this.repo.appendParticipant(callSid, participant);
    // Keep the live UI in sync (participants show on the calls page).
    const record = await this.repo.getBySid(callSid);
    if (record && !record.internalLegOf) {
      this.bus?.publish({ type: 'call.upserted', call: record });
    }
  }

  list(
    filter: Parameters<CallsRepository['list']>[0],
    cursor: string | undefined,
    limit: number,
  ) {
    return this.repo.list(filter, cursor, limit);
  }

  /**
   * How many calls the filter selects — the number behind "Page 2 of 7".
   *
   * Behind a short cache, and it earns it more than any other list: the log is
   * the biggest table in the app, and a dispatcher changes filters constantly.
   */
  async count(filter: Parameters<CallsRepository['count']>[0]): Promise<ListCount> {
    const take = async () => (await this.countFromCounters(filter)) ?? this.repo.count(filter);
    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('calls', { ...filter }),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  /**
   * An unfiltered or date-only count off the month counters: the months the
   * window covers whole are read from `CALLCOUNT`, the edge months of a date
   * window are walked (in parallel). Null — walk the log as before — for any
   * other filter, or while the counters have not been recounted.
   */
  private async countFromCounters(filter: ListCallsFilter): Promise<CountRowsResult | null> {
    if (!this.counters) return null;
    const keys = Object.keys(filter).filter((k) => filter[k as keyof ListCallsFilter] !== undefined);
    if (keys.some((k) => k !== 'dateFrom' && k !== 'dateTo')) return null;
    try {
      if (!(await this.counters.ready())) return null;
      const months = monthsDescending(filter.dateFrom, filter.dateTo);
      if (!months.length) return { total: 0, atLeast: false };
      const whole = months.filter((m) => monthFullyCovered(m, filter.dateFrom, filter.dateTo));
      const edges = months.filter((m) => !whole.includes(m));
      const [stored, walked] = await Promise.all([
        whole.length
          ? this.counters.months(whole[whole.length - 1], whole[0])
          : Promise.resolve(new Map<string, number>()),
        edges.length ? this.repo.count(filter, { months: edges }) : Promise.resolve({ total: 0, atLeast: false }),
      ]);
      let total = walked.total;
      for (const m of whole) total += stored.get(m) ?? 0;
      return { total, atLeast: walked.atLeast };
    } catch (err) {
      this.logger.warn(`Calls count: counters unavailable, walking — ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * The stat cards over the log for the calls a filter selects — Workiz's
   * `aggs` (see `call-summary.ts` for each number's rule).
   *
   * The count's walk with a projection, so CALLS is the table's "of N"; the
   * revenue is asked of deal-service only for a viewer who may see money.
   * Kept thirty seconds like the count — per filter and per money/no-money,
   * so one viewer's answer never hands another the revenue. When deal-service
   * cannot say, the cards come back without revenue and are not kept: a
   * report must not print $0 because a neighbour blinked.
   */
  async summary(
    filter: Parameters<CallsRepository['walkSelection']>[0],
    opts: { withRevenue: boolean },
  ): Promise<CallsSummary> {
    const key = countCacheKey(opts.withRevenue ? 'calls-summary-money' : 'calls-summary', { ...filter });
    try {
      const hit = await this.redis?.client.get(key);
      if (hit) return JSON.parse(hit) as CallsSummary;
    } catch {
      // A cache that is down is a miss.
    }

    const tally = new CallsSummaryTally();
    const stored = new StoredDealTotals();
    const { atLeast } = await this.repo.walkSelection(filter, SUMMARY_ATTRIBUTES, (row) => {
      tally.add(row as unknown as SummaryCall);
      stored.add(row);
    });

    let totals: ReadonlyMap<string, number> | undefined;
    let keep = true;
    if (opts.withRevenue) {
      // The rows carry their job's total; deal-service is asked only for the
      // jobs whose rows have none yet (old data, before the backfill).
      const ids = tally.dealIds();
      const missing = stored.missing(ids);
      if (!ids.length) {
        totals = new Map();
      } else if (!missing.length) {
        totals = stored.totals;
      } else if (this.dealTotals) {
        try {
          totals = stored.merged(await this.dealTotals.totals(missing));
        } catch (err) {
          keep = false;
          this.logger.warn(`Calls summary: job totals unavailable — ${(err as Error).message}`);
        }
      } else {
        keep = false;
      }
    }

    const out = tally.result({ atLeast, totals });
    if (keep) {
      try {
        await this.redis?.client.set(key, JSON.stringify(out), 'EX', COUNT_TTL_SECONDS);
      } catch {
        // The answer stands even when it cannot be kept.
      }
    }
    return out;
  }

  /**
   * The dashboard's "Top Call Flows": calls per flow per day over a window of
   * whole days (at most a quarter).
   *
   * A snapshot, not a live read: walking a month of the call log is not
   * something to do while someone waits for the dashboard. The nightly run
   * (`warmFlows`) builds each range ahead of time and it is kept until the
   * next; `computedAt` says when. `fresh` — the card's refresh — rebuilds it.
   */
  async topFlows(
    window: { from?: string; to?: string },
    opts: { fresh?: boolean } = {},
  ): Promise<CallFlowSeries> {
    const { from, to } = window;
    if (!from || !to || !DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw new BadRequestException('from and to are YYYY-MM-DD days');
    }
    if (to < from) throw new BadRequestException('The window must start on or before it ends');
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > FLOW_WINDOW_MAX_DAYS) {
      throw new BadRequestException(`The window is limited to ${FLOW_WINDOW_MAX_DAYS} days`);
    }

    const key = `calls:top-flows:${from}:${to}`;
    if (!opts.fresh) {
      const hit = await this.redis?.client.get(key);
      const cached = hit ? (JSON.parse(hit) as CallFlowSeries) : null;
      // A value from before snapshots carries no moment; rebuild it.
      if (cached?.computedAt) return cached;
    }

    const { byFlow, atLeast } = await this.repo.flowCallsByDay({ from, to });
    const series = { ...callFlowSeries(byFlow, { from, to }, atLeast), computedAt: new Date().toISOString() };
    await this.redis?.client.set(key, JSON.stringify(series), 'EX', FLOW_SNAPSHOT_TTL_SECONDS);
    return series;
  }

  /** The nightly run: every range the widget offers, ending today in New York, one at a time. */
  async warmFlows(now: Date): Promise<void> {
    for (const days of DASHBOARD_RANGES) {
      await this.topFlows(dashboardWindow(days, now), { fresh: true });
    }
  }

  /**
   * Live calls, with a stale sweep: a lost webhook (deploy, crashed dev run)
   * can strand a record in a live status forever. Ring-phase statuses can't
   * plausibly outlive the 25s ring timeout by minutes, and no call here runs
   * for 8h — such records are healed to `canceled` and dropped.
   */
  async listLive(now: number = Date.now()): Promise<CallRecord[]> {
    const RING_STALE_MS = 10 * 60_000;
    const TALK_STALE_MS = 8 * 60 * 60_000;

    const all = await this.repo.listLive(now);
    const fresh: CallRecord[] = [];
    for (const call of all) {
      const age = now - new Date(call.startedAt).getTime();
      const stale =
        call.status === 'in-progress' ? age > TALK_STALE_MS : age > RING_STALE_MS;
      if (!stale) {
        fresh.push(call);
        continue;
      }
      this.logger.warn(`Healing stale live call ${call.callSid} (${call.status})`);
      void this.applyLifecycle({
        callSid: call.callSid,
        status: 'canceled',
        endedAt: new Date(now).toISOString(),
      }).catch(() => undefined);
    }
    return fresh;
  }

  /** Persist a Twilio status callback as a call record. No-op without a CallSid. */
  async recordStatus(
    params: TwilioStatusParams,
    now: string = new Date().toISOString(),
  ): Promise<void> {
    if (!params.CallSid) return;

    const existing = await this.repo.getBySid(params.CallSid);
    const reported = normalizeStatus(params.CallStatus);

    // A blocked caller's leg was rejected before it rang; Twilio still
    // reports the leg's own end (busy / no-answer / failed, by the reject
    // reason). The row already says everything: `blocked` stays.
    if (existing?.status === 'blocked') return;

    // Conference-managed calls are written exclusively by the orchestration —
    // the TwiML-App-level status callback reports SDK legs as
    // Direction=inbound / From=client:… / To="" and would trash the record.
    //
    // The STATUS, though, is the one thing this callback is honest about, and
    // sometimes it is the only word we get: hang up fast enough and the leg
    // dies before it joins its conference, so no conference is ever created
    // and no conference-end fires. Dropping this left the record live until
    // the ten-minute stale sweep, and `activeCallFor` refused to place another
    // call for that whole time — one quick hang-up cost somebody their phone.
    if (existing?.conferenceName) {
      if (isTerminalStatus(reported) && !existing.answeredAt) {
        await this.applyLifecycle({
          callSid: params.CallSid,
          // Nobody spoke, so it is not a "completed" call — the same rule the
          // conference-end handler applies, so both routes agree. A more
          // specific failure (busy, no-answer) says more and is kept.
          status: reported === 'completed' ? 'canceled' : reported,
          endedAt: now,
        });
      }
      // An answered call has a conference, and its end event is the authority:
      // it completes the child legs and finalises with the duration.
      return;
    }

    // The agent leg appears as `client:<identity>` on either From (outbound)
    // or To (inbound routed to <Client>).
    const agentId =
      agentFromEndpoint(params.From) ?? agentFromEndpoint(params.To);

    const record: CallRecord = {
      callSid: params.CallSid,
      status: reported,
      from: params.From,
      to: params.To,
      direction: normalizeDirection(params.Direction),
      agentId,
      durationSeconds: params.CallDuration
        ? Number(params.CallDuration)
        : undefined,
      startedAt: params.Timestamp
        ? new Date(params.Timestamp).toISOString()
        : now,
      updatedAt: now,
    };

    this.countWrite(await this.repo.upsert(record), record);
    if (isTerminalStatus(reported) && existing?.status !== reported && !isTerminalStatus(existing?.status)) {
      this.finalizer?.schedule(params.CallSid);
    }
  }

  listByParty(kind: string, id: string, limit: number, cursor?: string) {
    return this.repo.listByParty(kind, id, limit, cursor);
  }

  listByAgent(agentId: string) {
    return this.repo.listByAgent(agentId);
  }
}
