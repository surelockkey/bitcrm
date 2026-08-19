import { Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';
import { RedisService } from '@bitcrm/shared';
import { CALL_FLOW_LIMITS, type CallFlow, type CallFlowNode } from '@bitcrm/types';
import {
  TELEPHONY_CONFIG,
  type TelephonyConfig,
} from '../telephony/telephony.config';
import { Inject } from '@nestjs/common';
import { CallFlowsService } from '../call-flows/call-flows.service';
import { CallGroupsService } from '../call-groups/call-groups.service';
import { CallsService } from '../calls/calls.service';
import { flowStateKey } from '../call-flows/call-flows.constants';
import {
  ConferenceService,
  confName,
  type InboundLeg,
} from './conference.service';

const VoiceResponse = twilio.twiml.VoiceResponse;

/** Everything a running call needs to keep, pinned for its lifetime. */
interface FlowState {
  /** A snapshot, not a reference: editing the flow mid-call must not move this caller. */
  flow: CallFlow;
  nodeId: string;
  hops: number;
  from: string;
  to: string;
}

const STATE_TTL_SECONDS = 4 * 60 * 60;

/**
 * Walks a call through its flow.
 *
 * Each node returns TwiML that either finishes the call or points Twilio back
 * at `/voice/flow` for the next step, which is what makes a greeting and a
 * menu possible at all: once a caller is inside a conference their TwiML is
 * done, and the conference is simply what the `ring` node ends with.
 *
 * The rule that outranks every other design point here: **a broken flow must
 * never mean a silent line.** Every failure path returns null so the caller
 * falls back to ringing whoever is online, exactly as before flows existed.
 */
@Injectable()
export class FlowRunnerService {
  private readonly logger = new Logger(FlowRunnerService.name);

  constructor(
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
    private readonly flows: CallFlowsService,
    private readonly groups: CallGroupsService,
    private readonly conference: ConferenceService,
    private readonly calls: CallsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Start the flow that answers this number. Null means "no flow, or the flow
   * is unusable" — the caller carries on down the legacy path.
   */
  async startInbound(
    callSid: string,
    from: string,
    to: string,
  ): Promise<string | null> {
    let flow: CallFlow | null = null;
    try {
      flow = await this.flows.findByNumber(to);
    } catch (error) {
      this.logger.error(
        `Flow lookup failed for ${to} — falling back: ${this.reason(error)}`,
      );
      return null;
    }
    if (!flow) return null;

    const entry = flow.nodes?.[flow.entryNodeId];
    if (!entry) {
      this.logger.error(
        `Flow "${flow.name}" has no usable first step — falling back`,
      );
      return null;
    }

    const state: FlowState = { flow, nodeId: entry.id, hops: 0, from, to };
    await this.save(callSid, state);
    return this.execute(callSid, state, entry);
  }

  /** Twilio came back for the next step. */
  async resume(callSid: string, nodeId: string): Promise<string | null> {
    const state = await this.load(callSid);
    if (!state) {
      this.logger.warn(`Flow resume for ${callSid}: no state — falling back`);
      return null;
    }

    // A caller bounced between steps forever is a trapped customer and a bill
    // that keeps running.
    if (state.hops >= CALL_FLOW_LIMITS.maxHops) {
      this.logger.error(
        `Flow "${state.flow.name}" exceeded ${CALL_FLOW_LIMITS.maxHops} steps on ${callSid}`,
      );
      return this.goodbye('Sorry, something went wrong with this call.');
    }

    const node = state.flow.nodes?.[nodeId];
    if (!node) {
      this.logger.error(
        `Flow "${state.flow.name}" has no step ${nodeId} — falling back`,
      );
      return null;
    }

    const next: FlowState = { ...state, nodeId, hops: state.hops + 1 };
    await this.save(callSid, next);
    return this.execute(callSid, next, node);
  }

  /* ----------------------------------------------------------- the nodes */

  private async execute(
    callSid: string,
    state: FlowState,
    node: CallFlowNode,
  ): Promise<string | null> {
    try {
      switch (node.type) {
        case 'say':
          return this.say(node.text, node.next);
        case 'hangup':
          return this.goodbye(node.text);
        case 'voicemail':
          return this.voicemail(node.prompt, node.maxSeconds);
        case 'ring':
          return await this.ring(callSid, state, node.groupId, node.next);
        default:
          this.logger.error(
            `Flow "${state.flow.name}": unknown step type — falling back`,
          );
          return null;
      }
    } catch (error) {
      this.logger.error(
        `Flow "${state.flow.name}" step ${node.id} failed — falling back: ${this.reason(error)}`,
      );
      return null;
    }
  }

  private say(text: string, next?: string): string {
    const twiml = new VoiceResponse();
    if (text?.trim()) twiml.say(text);
    if (next) twiml.redirect({ method: 'POST' }, this.stepUrl(next));
    else twiml.hangup();
    return twiml.toString();
  }

  private goodbye(text?: string): string {
    const twiml = new VoiceResponse();
    if (text?.trim()) twiml.say(text);
    twiml.hangup();
    return twiml.toString();
  }

  private voicemail(prompt: string, maxSeconds: number): string {
    const twiml = new VoiceResponse();
    if (prompt?.trim()) twiml.say(prompt);
    twiml.record({
      maxLength: maxSeconds,
      playBeep: true,
      // Transcription is what makes a voicemail readable in the call log
      // rather than something somebody has to listen to.
      transcribe: true,
      transcribeCallback: `${this.base()}/voicemail-transcription`,
      recordingStatusCallback: `${this.base()}/voicemail-recording`,
      recordingStatusCallbackMethod: 'POST',
    });
    twiml.hangup();
    return twiml.toString();
  }

  /**
   * Ring a group and park the caller in the conference — this is the node that
   * ends in today's behaviour, and the only one that touches Twilio directly.
   */
  private async ring(
    callSid: string,
    state: FlowState,
    groupId: string,
    next: string | undefined,
  ): Promise<string | null> {
    const group = await this.groups.findRaw(groupId);
    if (!group) {
      this.logger.error(`Flow step rings group ${groupId}, which is gone — falling back`);
      return null;
    }

    const targets = await this.groups.resolveTargets(group);
    if (targets.length === 0) {
      // Nobody in this group is reachable. Going straight to the next step is
      // the whole point of having one — the alternative is ringing silence.
      this.logger.log(`Flow: group "${group.name}" has nobody reachable`);
      if (!next) return this.goodbye('Sorry, nobody is available to take your call.');
      return this.resume(callSid, next);
    }

    const legs: InboundLeg[] = targets.map((target) => ({
      endpoint: target.endpoint,
      // A softphone shows the customer's number so the screen-pop works. A
      // personal phone shows ours, so the tech's callback comes back through
      // the CRM instead of going direct and vanishing from the log.
      callerId: target.channel === 'softphone' ? state.from : state.to,
    }));

    await this.conference.initInbound(callSid, state.from, state.to, legs, {
      ringSeconds: group.ringSeconds,
      noAnswerUrl: next ? this.stepUrl(next) : undefined,
    });

    const twiml = new VoiceResponse();
    const dial = twiml.dial();
    dial.conference(
      {
        ...this.conference.sharedConferenceAttrs(),
        startConferenceOnEnter: false,
        endConferenceOnExit: true,
      } as Parameters<InstanceType<typeof VoiceResponse.Dial>['conference']>[0],
      confName(callSid),
    );
    return twiml.toString();
  }

  /* ---------------------------------------------------------------- state */

  private base(): string {
    return `${this.config.publicBaseUrl}/api/telephony/voice`;
  }

  private stepUrl(nodeId: string): string {
    return `${this.base()}/flow?node=${encodeURIComponent(nodeId)}`;
  }

  private async save(callSid: string, state: FlowState): Promise<void> {
    await this.redis.client.set(
      flowStateKey(callSid),
      JSON.stringify(state),
      'EX',
      STATE_TTL_SECONDS,
    );
  }

  private async load(callSid: string): Promise<FlowState | null> {
    try {
      const raw = await this.redis.client.get(flowStateKey(callSid));
      return raw ? (JSON.parse(raw) as FlowState) : null;
    } catch {
      return null;
    }
  }

  /** Attach a voicemail recording to the call it was left on. */
  async onVoicemailRecording(params: {
    CallSid?: string;
    RecordingSid?: string;
    RecordingStatus?: string;
    RecordingDuration?: string;
  }): Promise<void> {
    if (params.RecordingStatus !== 'completed' || !params.CallSid) return;
    await this.calls.applyLifecycle({
      callSid: params.CallSid,
      recordingSid: params.RecordingSid,
      recordingDurationSeconds: params.RecordingDuration
        ? Number(params.RecordingDuration)
        : undefined,
    });
    this.logger.log(`Voicemail recorded on ${params.CallSid}`);
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
