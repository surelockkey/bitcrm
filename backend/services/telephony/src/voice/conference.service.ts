import { Inject, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import {
  TELEPHONY_CONFIG,
  type TelephonyConfig,
} from '../telephony/telephony.config';
import { TwilioRest } from '../common/twilio-client';
import {
  CallsService,
  normalizeStatus,
  type TwilioStatusParams,
} from '../calls/calls.service';

export type MonitorMode = 'listen' | 'join';

/** Terminal Twilio leg statuses (ring legs / customer participant). */
const TERMINAL_LEG = new Set([
  'completed',
  'busy',
  'no-answer',
  'failed',
  'canceled',
]);

/** Redis state TTL — well past any realistic call length. */
const CONF_TTL_SECONDS = 4 * 60 * 60;
const MONITOR_GRANT_TTL_SECONDS = 120;

export const confName = (primarySid: string) => `conf-${primarySid}`;
export const primarySidOf = (name: string): string | null =>
  /^conf-(CA\w+)$/.exec(name)?.[1] ?? null;

/**
 * Owns the per-conference orchestration: Redis call state, the Twilio REST
 * legs (outbound customer participant, inbound agent ring legs, sibling
 * cancellation), winner claims, monitor grants, and record finalization.
 * TwiML *shapes* live in VoiceService; everything with side effects lives here.
 */
@Injectable()
export class ConferenceService {
  private readonly logger = new Logger(ConferenceService.name);
  private rest: TwilioRest;

  constructor(
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
    private readonly redis: RedisService,
    private readonly calls: CallsService,
  ) {
    this.rest = new TwilioRest(config);
  }

  /* ------------------------------------------------------------- keys */

  private metaKey(name: string) {
    return `telephony:conf:${name}:meta`;
  }
  private pendingKey(name: string) {
    return `telephony:conf:${name}:pending`;
  }
  private winnerKey(name: string) {
    return `telephony:conf:${name}:winner`;
  }
  private monitorKey(userId: string, name: string) {
    return `telephony:monitor:${userId}:${name}`;
  }
  private statusUrl(name: string, role: 'customer' | 'agent') {
    return `${this.config.publicBaseUrl}/api/telephony/voice/status?conf=${name}&role=${role}`;
  }

  /* -------------------------------------------------------- lifecycle */

  /** Outbound: agent leg hit /voice/outbound; stash context + open the record. */
  async initOutbound(
    agentCallSid: string,
    agentId: string | undefined,
    to: string,
    callerId: string,
  ): Promise<void> {
    const name = confName(agentCallSid);
    await this.redis.client.hset(this.metaKey(name), {
      type: 'outbound',
      primarySid: agentCallSid,
      to,
      from: callerId,
      ...(agentId && { agentId }),
    });
    await this.redis.client.expire(this.metaKey(name), CONF_TTL_SECONDS);

    await this.calls.applyLifecycle({
      callSid: agentCallSid,
      direction: 'outbound',
      from: callerId,
      to,
      status: 'initiated',
      agentId,
      conferenceName: name,
    });
    if (agentId) {
      await this.calls.appendParticipant(agentCallSid, {
        userId: agentId,
        role: 'caller',
        at: new Date().toISOString(),
      });
    }
    this.logger.log(`Outbound call ${agentCallSid} → ${to} (conf ${name})`);
  }

  /**
   * The live outbound call that dialed `to` from `from` — used to link the
   * receiving side of a company-internal call to the record the caller made.
   */
  async findLinkedOutbound(
    from: string,
    to: string,
  ): Promise<string | undefined> {
    const live = await this.calls.listLive();
    return live.find(
      (c) => c.direction === 'outbound' && c.from === from && c.to === to,
    )?.callSid;
  }

  /** Inbound: customer parked in the conference; ring every online agent. */
  async initInbound(
    customerCallSid: string,
    from: string,
    to: string,
    agentIdentities: string[],
    internalLegOf?: string,
  ): Promise<void> {
    const name = confName(customerCallSid);
    await this.redis.client.hset(this.metaKey(name), {
      type: 'inbound',
      primarySid: customerCallSid,
      from,
      to,
      ...(internalLegOf && { internalLegOf }),
    });
    await this.redis.client.expire(this.metaKey(name), CONF_TTL_SECONDS);

    await this.calls.applyLifecycle({
      callSid: customerCallSid,
      direction: 'inbound',
      from,
      to,
      status: 'ringing',
      conferenceName: name,
      internalLegOf,
    });

    for (const identity of agentIdentities) {
      try {
        const leg = await this.rest.run((c) =>
          c.calls.create({
            to: `client:${identity}`,
            // caller id = the customer's number so the softphone screen-pop works
            from,
            url: `${this.config.publicBaseUrl}/api/telephony/voice/agent-join?conf=${name}`,
            method: 'POST',
            timeout: 25,
            statusCallback: this.statusUrl(name, 'agent'),
            statusCallbackMethod: 'POST',
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          }),
        );
        await this.redis.client.sadd(this.pendingKey(name), leg.sid);
        await this.calls.appendChildSid(customerCallSid, leg.sid);
      } catch (error) {
        this.logger.warn(
          `Inbound ${name}: failed to ring agent ${identity}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    await this.redis.client.expire(this.pendingKey(name), CONF_TTL_SECONDS);
    this.logger.log(
      `Inbound call ${customerCallSid} ringing ${agentIdentities.length} agent(s) (conf ${name})`,
    );
  }

  /**
   * A participant entered the conference. The load-bearing case: the OUTBOUND
   * agent's join is the moment the conference exists on Twilio's side, so this
   * is where the customer participant is created. (It can NOT wait for
   * `conference-start`: Twilio doesn't start a one-participant conference —
   * regardless of startConferenceOnEnter — so start never fires until a second
   * participant exists. The agent would sit on hold music forever.)
   */
  async onParticipantJoin(
    name: string,
    conferenceSid: string,
    participantCallSid?: string,
  ): Promise<void> {
    const primarySid = primarySidOf(name);
    if (!primarySid) return;

    await this.rememberConferenceSid(name, conferenceSid, primarySid);

    const metaKey = this.metaKey(name);
    const meta = await this.redis.client.hgetall(metaKey);
    // Only the outbound agent leg's own join spawns the customer dial.
    if (meta.type !== 'outbound' || participantCallSid !== primarySid) return;
    if (!meta.to) return;

    // Atomic claim — join and (later) start events must not double-dial.
    const claimed = await this.redis.client.set(
      `telephony:conf:${name}:customer-dial`,
      participantCallSid,
      'EX',
      CONF_TTL_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') return;

    try {
      const participant = await this.rest.run((c) =>
        c.conferences(conferenceSid).participants.create({
          to: meta.to,
          from: meta.from || this.config.callerId,
          earlyMedia: true,
          endConferenceOnExit: true,
          label: 'customer',
          statusCallback: this.statusUrl(name, 'customer'),
          statusCallbackMethod: 'POST',
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        }),
      );
      await this.redis.client.hset(metaKey, { customerSid: participant.callSid });
      await this.calls.appendChildSid(primarySid, participant.callSid);
      await this.calls.applyLifecycle({ callSid: primarySid, status: 'ringing' });
      this.logger.log(`Conference ${name}: dialing customer ${meta.to}`);
    } catch (error) {
      this.logger.error(
        `Conference ${name}: customer dial failed: ${error instanceof Error ? error.message : error}`,
      );
      await this.completeConference(conferenceSid);
      await this.calls.applyLifecycle({ callSid: primarySid, status: 'failed' });
    }
  }

  /** Conference began mixing (second participant arrived). Bookkeeping only. */
  async onConferenceStart(name: string, conferenceSid: string): Promise<void> {
    const primarySid = primarySidOf(name);
    if (!primarySid) return;
    await this.rememberConferenceSid(name, conferenceSid, primarySid);
  }

  private async rememberConferenceSid(
    name: string,
    conferenceSid: string,
    primarySid: string,
  ): Promise<void> {
    await this.redis.client.hset(this.metaKey(name), { confSid: conferenceSid });
    // Reverse mapping for the recording callback (which only carries the SID).
    // Deliberately NOT deleted at conference-end — recordings land afterwards.
    await this.redis.client.set(
      `telephony:confsid:${conferenceSid}`,
      name,
      'EX',
      CONF_TTL_SECONDS,
    );
    await this.calls.applyLifecycle({ callSid: primarySid, conferenceSid });
  }

  /** Conference over — finalize the record and tidy every loose end. */
  async onConferenceEnd(name: string): Promise<void> {
    const primarySid = primarySidOf(name);
    if (!primarySid) return;

    const record = await this.calls.getBySid(primarySid);
    const endedAt = new Date().toISOString();

    // Belt and braces: REST-complete any child leg that might still be live
    // (e.g. customer still ringing when the agent hung up).
    for (const childSid of record?.childSids ?? []) {
      try {
        await this.rest.run((c) => c.calls(childSid).update({ status: 'completed' }));
      } catch {
        /* already terminal — fine */
      }
    }

    await this.calls.applyLifecycle({
      callSid: primarySid,
      endedAt,
      // answered → completed; never answered → canceled. The monotonic guard
      // keeps any earlier terminal status (busy/no-answer/failed) in place.
      status: record?.answeredAt ? 'completed' : 'canceled',
    });

    await this.redis.client.del(
      this.metaKey(name),
      this.pendingKey(name),
      this.winnerKey(name),
      `telephony:conf:${name}:customer-dial`,
    );
    this.logger.log(`Conference ${name} ended`);
  }

  /* --------------------------------------------- inbound winner race */

  /** Atomic first-answer-wins claim (SET NX). */
  async claimWinner(
    name: string,
    agentCallSid: string,
  ): Promise<'winner' | 'loser'> {
    const res = await this.redis.client.set(
      this.winnerKey(name),
      agentCallSid,
      'EX',
      CONF_TTL_SECONDS,
      'NX',
    );
    return res === 'OK' ? 'winner' : 'loser';
  }

  /** The winning agent is entering the conference. */
  async onWinner(
    name: string,
    agentCallSid: string,
    agentIdentity: string,
  ): Promise<void> {
    const primarySid = primarySidOf(name);
    if (!primarySid) return;

    const at = new Date().toISOString();
    await this.calls.applyLifecycle({
      callSid: primarySid,
      agentId: agentIdentity,
      answeredAt: at,
      status: 'in-progress',
    });
    await this.calls.appendParticipant(primarySid, {
      userId: agentIdentity,
      role: 'answered',
      at,
    });

    // Internal call (our number → our number): the visible record is the
    // caller's — surface the answering agent there too, as one call.
    const meta = await this.redis.client.hgetall(this.metaKey(name));
    if (meta.internalLegOf) {
      await this.calls.appendParticipant(meta.internalLegOf, {
        userId: agentIdentity,
        role: 'answered',
        at,
      });
      await this.calls.applyLifecycle({
        callSid: meta.internalLegOf,
        answeredAt: at,
      });
    }

    // Cancel still-ringing siblings — best-effort cleanup, the webhook-based
    // winner claim is what guarantees only one agent enters the conference.
    const pending = await this.redis.client.smembers(this.pendingKey(name));
    for (const sid of pending) {
      if (sid === agentCallSid) continue;
      try {
        await this.rest.run((c) => c.calls(sid).update({ status: 'completed' }));
      } catch {
        /* leg already ended */
      }
    }
    this.logger.log(`Conference ${name}: answered by ${agentIdentity}`);
  }

  /* --------------------------------------------------- leg callbacks */

  /** Status callback for a REST-created leg (?conf=<name>&role=…). */
  async onLegStatus(
    name: string,
    role: 'customer' | 'agent',
    params: TwilioStatusParams,
  ): Promise<void> {
    const primarySid = primarySidOf(name);
    const status = normalizeStatus(params.CallStatus);
    if (!primarySid || !params.CallSid || !status) return;

    if (role === 'customer') {
      if (status === 'in-progress') {
        await this.calls.applyLifecycle({
          callSid: primarySid,
          answeredAt: new Date().toISOString(),
          status: 'in-progress',
        });
        return;
      }
      if (TERMINAL_LEG.has(status) && status !== 'completed') {
        // busy / no-answer / failed / canceled on the customer leg — the call
        // never happened; end the conference (agent side) and record why.
        const meta = await this.redis.client.hgetall(this.metaKey(name));
        if (meta.confSid) await this.completeConference(meta.confSid);
        await this.calls.applyLifecycle({ callSid: primarySid, status });
      }
      return;
    }

    // role === 'agent' — inbound ring legs.
    if (TERMINAL_LEG.has(status)) {
      await this.redis.client.srem(this.pendingKey(name), params.CallSid);
      const [remaining, winner] = await Promise.all([
        this.redis.client.scard(this.pendingKey(name)),
        this.redis.client.get(this.winnerKey(name)),
      ]);
      if (remaining === 0 && !winner) {
        // Every agent leg died without anyone answering — release the customer.
        this.logger.log(`Conference ${name}: no agent answered`);
        try {
          await this.rest.run((c) =>
            c.calls(primarySid).update({
              twiml:
                '<Response><Say>Sorry, no agents are available to take your call right now. Please try again later.</Say><Hangup/></Response>',
            }),
          );
        } catch {
          /* customer already gone */
        }
        await this.calls.applyLifecycle({ callSid: primarySid, status: 'no-answer' });
      }
    }
  }

  /* -------------------------------------------------------- recording */

  /** Conference recording is ready (arrives shortly after conference-end). */
  async onRecordingStatus(params: {
    RecordingSid?: string;
    RecordingStatus?: string;
    RecordingDuration?: string;
    ConferenceSid?: string;
  }): Promise<string | null> {
    if (params.RecordingStatus !== 'completed' || !params.RecordingSid) {
      return null;
    }
    const name = params.ConferenceSid
      ? await this.redis.client.get(`telephony:confsid:${params.ConferenceSid}`)
      : null;
    const primarySid = name ? primarySidOf(name) : null;
    if (!primarySid) {
      this.logger.warn(
        `Recording ${params.RecordingSid}: unknown conference ${params.ConferenceSid}`,
      );
      return null;
    }

    await this.calls.applyLifecycle({
      callSid: primarySid,
      recordingSid: params.RecordingSid,
      recordingDurationSeconds: params.RecordingDuration
        ? Number(params.RecordingDuration)
        : undefined,
    });
    this.logger.log(`Recording ready for ${primarySid} (${params.RecordingSid})`);
    return primarySid;
  }

  /* ------------------------------------------------------- monitoring */

  async grantMonitor(
    userId: string,
    name: string,
    mode: MonitorMode,
  ): Promise<void> {
    await this.redis.client.set(
      this.monitorKey(userId, name),
      mode,
      'EX',
      MONITOR_GRANT_TTL_SECONDS,
    );
    this.logger.log(`Monitor grant: ${userId} → ${name} (${mode})`);
  }

  /** Single-use read of a monitor grant (GETDEL). */
  async consumeMonitorGrant(
    userId: string,
    name: string,
  ): Promise<MonitorMode | null> {
    const mode = await this.redis.client.getdel(this.monitorKey(userId, name));
    return mode === 'listen' || mode === 'join' ? mode : null;
  }

  /** A supervisor actually connected into the call — record who and how. */
  async recordMonitorParticipant(
    name: string,
    userId: string,
    mode: MonitorMode,
  ): Promise<void> {
    const primarySid = primarySidOf(name);
    if (!primarySid) return;
    await this.calls.appendParticipant(primarySid, {
      userId,
      role: mode === 'listen' ? 'listened' : 'joined',
      at: new Date().toISOString(),
    });
  }

  /** The live conference SID for a conference name, if we've seen it start. */
  async conferenceSidOf(name: string): Promise<string | null> {
    const meta = await this.redis.client.hgetall(this.metaKey(name));
    if (meta.confSid) return meta.confSid;
    const primarySid = primarySidOf(name);
    if (!primarySid) return null;
    const record = await this.calls.getBySid(primarySid);
    return record?.conferenceSid ?? null;
  }

  async isConferenceLive(conferenceSid: string): Promise<boolean> {
    try {
      const conf = await this.rest.run((c) => c.conferences(conferenceSid).fetch());
      return conf.status === 'in-progress';
    } catch {
      return false;
    }
  }

  private async completeConference(conferenceSid: string): Promise<void> {
    try {
      await this.rest.run((c) =>
        c.conferences(conferenceSid).update({ status: 'completed' }),
      );
    } catch {
      /* already completed */
    }
  }
}
