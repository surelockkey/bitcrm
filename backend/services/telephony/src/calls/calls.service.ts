import { Injectable, Logger, Optional } from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { CallEventType } from '@bitcrm/types';
import {
  CallsRepository,
  type CallRecord,
  type CallStatus,
} from './calls.repository';
import { CallEventsBus } from './call-events.bus';
import { DealLinkService } from '../common/deal-link.service';
import { NumberSettingsRepository } from '../numbers/number-settings.repository';

/** Raw form params Twilio POSTs to the status callback (subset we use). */
export interface TwilioStatusParams {
  CallSid?: string;
  CallStatus?: string;
  From?: string;
  To?: string;
  Direction?: string;
  CallDuration?: string;
  Timestamp?: string;
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

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly repo: CallsRepository,
    @Optional() private readonly bus?: CallEventsBus,
    @Optional() private readonly dealLinks?: DealLinkService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly numberSettings?: NumberSettingsRepository,
  ) {}

  /**
   * Call-tracking attribution: the tracked number a call came through decides
   * its job source (inbound → the number dialed, outbound → our caller id).
   * Resolved only while the record has no source yet — a number reassigned to
   * another campaign later must not rewrite settled history — and a lookup
   * failure never fails the call write.
   */
  private async resolveSource(
    update: LifecycleUpdate,
    existing: CallRecord | null,
  ): Promise<string | undefined> {
    if (existing?.sourceId || !this.numberSettings) return undefined;
    const direction = update.direction ?? existing?.direction;
    const tracked =
      direction === 'inbound'
        ? (update.to ?? existing?.to)
        : direction === 'outbound'
          ? (update.from ?? existing?.from)
          : undefined;
    if (!tracked) return undefined;
    try {
      return (await this.numberSettings.get(tracked))?.sourceId;
    } catch (err) {
      this.logger.warn(
        `Source lookup for ${tracked} failed: ${err instanceof Error ? err.message : err}`,
      );
      return undefined;
    }
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

    // Guarded before the await: without a settings repo (or with the source
    // already settled) the write path keeps its exact microtask profile —
    // fire-and-forget callers (the stale-live heal) rely on it landing fast.
    const needSource =
      !update.sourceId && !existing?.sourceId && !!this.numberSettings;
    const record: CallRecord = {
      ...update,
      status,
      durationSeconds,
      sourceId:
        update.sourceId ??
        (needSource ? await this.resolveSource(update, existing) : undefined),
      startedAt: update.startedAt ?? existing?.startedAt ?? now,
      updatedAt: now,
    };
    await this.repo.upsert(record);
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
   * Freeze who a finished call was with. One-shot at the repository level, so
   * calling it again is harmless — which is what makes it safe to trigger
   * from a read path.
   */
  freezeParties(
    callSid: string,
    parties: Parameters<CallsRepository['setParties']>[1],
    startedAt: string,
  ) {
    return this.repo.setParties(callSid, parties, startedAt, 'auto');
  }

  /**
   * A person correcting who a call was with. Overwrites whatever automatic
   * resolution decided and marks the record so it is never re-derived.
   */
  setPartiesManually(
    callSid: string,
    parties: Parameters<CallsRepository['setParties']>[1],
    startedAt: string,
  ) {
    return this.repo.setParties(callSid, parties, startedAt, 'manual');
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
    const after = await this.repo.getBySid(callSid);

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

    await this.repo.upsert(record);
  }

  listByParty(kind: string, id: string, limit: number, cursor?: string) {
    return this.repo.listByParty(kind, id, limit, cursor);
  }

  listByAgent(agentId: string) {
    return this.repo.listByAgent(agentId);
  }
}
