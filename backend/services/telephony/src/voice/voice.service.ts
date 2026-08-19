import { Inject, Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';
import {
  TELEPHONY_CONFIG,
  type TelephonyConfig,
} from '../telephony/telephony.config';
import { PresenceService } from '../presence/presence.service';
import { NumbersService } from '../numbers/numbers.service';
import { ConferenceService, confName } from './conference.service';
import { FlowRunnerService } from './flow-runner.service';
import { agentFromEndpoint } from '../calls/calls.service';

const VoiceResponse = twilio.twiml.VoiceResponse;
type ConferenceAttrs = Parameters<
  InstanceType<typeof VoiceResponse.Dial>['conference']
>[0];

/** Params the Twilio Voice SDK / webhooks POST to /voice/outbound. */
export interface OutboundBody {
  CallSid?: string;
  From?: string;
  To?: string;
  CallerId?: string;
  /** Set when a supervisor connects to monitor: the conference name. */
  Monitor?: string;
  MonitorMode?: string;
}

export interface InboundBody {
  CallSid?: string;
  From?: string;
  To?: string;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  /** Cached fallback caller id resolved from owned numbers. */
  private cachedDefaultCallerId: string | null = null;
  /** Cached set of our own numbers (internal-call detection). */
  private ownedNumbersCache: { numbers: Set<string>; expiresAt: number } | null =
    null;

  constructor(
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
    private readonly presence: PresenceService,
    private readonly conference: ConferenceService,
    private readonly flowRunner: FlowRunnerService,
    private readonly numbers?: NumbersService,
  ) {}

  /** Shared by every <Conference> we emit — see ConferenceService. */
  private sharedConferenceAttrs(): ConferenceAttrs {
    return this.conference.sharedConferenceAttrs() as ConferenceAttrs;
  }

  /**
   * The caller id for an outbound call: the number the agent picked in the
   * dialer when it's plausible E.164; else the configured default; else the
   * account's first owned number (cached). Twilio rejects caller ids the
   * account doesn't own, so this is a sanity filter, not a security boundary.
   */
  private async pickCallerId(requested?: string): Promise<string | undefined> {
    if (requested && /^\+\d{6,15}$/.test(requested)) return requested;
    if (this.config.callerId) return this.config.callerId;
    if (this.cachedDefaultCallerId) return this.cachedDefaultCallerId;
    try {
      const owned = (await this.numbers?.listOwned()) ?? [];
      this.cachedDefaultCallerId = owned[0]?.phoneNumber ?? null;
      return this.cachedDefaultCallerId ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Outbound webhook (TwiML App voice URL). Two cases share it:
   *  - a normal agent call: agent joins the per-call conference (owning its
   *    lifecycle); the customer participant is created at conference-start.
   *  - a supervisor monitor connect (Monitor param): validated via the
   *    single-use grant, then joined muted (listen) or unmuted (join).
   */
  async buildOutbound(body: OutboundBody): Promise<string> {
    if (body.Monitor) return this.buildMonitor(body);

    const twiml = new VoiceResponse();
    const { To: to, CallSid: callSid } = body;

    if (!to || !callSid) {
      twiml.say('No destination number was provided.');
      twiml.hangup();
      return twiml.toString();
    }

    const from = await this.pickCallerId(body.CallerId);
    if (!from) {
      twiml.say('No caller id is configured. Please add a phone number.');
      twiml.hangup();
      return twiml.toString();
    }

    const name = confName(callSid);
    await this.conference.initOutbound(
      callSid,
      agentFromEndpoint(body.From),
      to,
      from,
    );

    const dial = twiml.dial();
    dial.conference(
      {
        ...this.sharedConferenceAttrs(),
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        beep: 'false',
      },
      name,
    );
    return twiml.toString();
  }

  /** Supervisor listen/join — see ConferenceService.grantMonitor. */
  private async buildMonitor(body: OutboundBody): Promise<string> {
    const twiml = new VoiceResponse();
    const name = body.Monitor!;
    const identity = agentFromEndpoint(body.From);

    const mode = identity
      ? await this.conference.consumeMonitorGrant(identity, name)
      : null;
    if (!mode) {
      twiml.say('You are not authorized to join this call.');
      twiml.hangup();
      return twiml.toString();
    }

    const confSid = await this.conference.conferenceSidOf(name);
    const live = confSid ? await this.conference.isConferenceLive(confSid) : false;
    if (!live) {
      // Two different failures wore the same message, which made a refused
      // join impossible to tell from a call that genuinely ended.
      this.logger.warn(
        `Join refused for ${identity} on ${name}: ` +
          (confSid
            ? `conference ${confSid} is not in progress`
            : 'no conference sid known for that name'),
      );
      twiml.say('That call has already ended.');
      twiml.hangup();
      return twiml.toString();
    }

    // The supervisor is definitely connecting now — log who and how.
    await this.conference.recordMonitorParticipant(name, identity!, mode);

    const dial = twiml.dial();
    dial.conference(
      {
        ...this.sharedConferenceAttrs(),
        muted: mode === 'listen',
        beep: 'false',
        startConferenceOnEnter: false,
        endConferenceOnExit: false,
      },
      name,
    );
    return twiml.toString();
  }

  /** Is this E.164 number one of the workspace's own Twilio numbers? */
  private async isOwnNumber(number: string): Promise<boolean> {
    if (!number) return false;
    const now = Date.now();
    if (!this.ownedNumbersCache || this.ownedNumbersCache.expiresAt < now) {
      try {
        const owned = (await this.numbers?.listOwned()) ?? [];
        this.ownedNumbersCache = {
          numbers: new Set(owned.map((n) => n.phoneNumber)),
          expiresAt: now + 60_000,
        };
      } catch {
        return false;
      }
    }
    return this.ownedNumbersCache.numbers.has(number);
  }

  /**
   * Inbound webhook: park the customer in the per-call conference (hold music
   * until an agent joins) and ring every online agent via REST legs. Nobody
   * online → a short message, then hang up.
   */
  async buildInbound(body: InboundBody): Promise<string> {
    const { CallSid: callSid, From: from = '', To: to = '' } = body;

    // A flow for this number decides everything from here — greeting, who
    // rings, what happens when nobody does. It returns null when there is no
    // flow, or the flow is unusable, and the legacy path below takes over: a
    // misconfigured flow must never mean a silent line.
    if (callSid) {
      const fromFlow = await this.flowRunner.startInbound(callSid, from, to);
      if (fromFlow) return fromFlow;
    }

    return this.buildLegacyInbound(body);
  }

  /**
   * Ring every registered softphone. What every number did before call flows,
   * and still the answer for a number with no flow attached.
   */
  private async buildLegacyInbound(body: InboundBody): Promise<string> {
    const twiml = new VoiceResponse();
    const { CallSid: callSid, From: from = '', To: to = '' } = body;

    const online = callSid ? await this.presence.listOnline() : [];
    if (!callSid || online.length === 0) {
      twiml.say(
        'Sorry, no agents are available to take your call right now. Please try again later.',
      );
      twiml.hangup();
      return twiml.toString();
    }

    // A call from one of our own numbers is the receiving side of an internal
    // call an agent just placed — link it so the log shows ONE call.
    let internalLegOf: string | undefined;
    if (await this.isOwnNumber(from)) {
      internalLegOf = await this.conference.findLinkedOutbound(from, to);
    }

    const name = confName(callSid);
    await this.conference.initInbound(
      callSid,
      from,
      to,
      // The customer's number as caller id, so the softphone screen-pops.
      online.map((identity) => ({ endpoint: `client:${identity}`, callerId: from })),
      { internalLegOf },
    );

    const dial = twiml.dial();
    dial.conference(
      {
        ...this.sharedConferenceAttrs(),
        startConferenceOnEnter: false,
        endConferenceOnExit: true,
      },
      name,
    );
    return twiml.toString();
  }

  /**
   * Answer webhook for an inbound agent ring leg. First answer wins the atomic
   * claim and enters (starting) the conference; late answers are told the call
   * was taken. This webhook — not inline TwiML — is what makes the race safe.
   */
  async buildAgentJoin(
    name: string,
    body: { CallSid?: string; To?: string },
  ): Promise<string> {
    const twiml = new VoiceResponse();
    const agentCallSid = body.CallSid;
    const identity = agentFromEndpoint(body.To);

    if (!agentCallSid || !identity) {
      twiml.hangup();
      return twiml.toString();
    }

    const outcome = await this.conference.claimWinner(name, agentCallSid);
    if (outcome === 'loser') {
      twiml.say('The call was answered by another agent.');
      twiml.hangup();
      return twiml.toString();
    }

    await this.conference.onWinner(name, agentCallSid, identity);
    const dial = twiml.dial();
    dial.conference(
      {
        ...this.sharedConferenceAttrs(),
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        beep: 'false',
      },
      name,
    );
    return twiml.toString();
  }
}
