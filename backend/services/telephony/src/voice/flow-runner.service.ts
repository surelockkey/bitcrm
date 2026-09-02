import { Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';
import { RedisService } from '@bitcrm/shared';
import {
  CALL_FLOW_LIMITS,
  type CallFlow,
  type CallFlowNode,
  type HoursNode,
  type MenuNode,
  type RingNode,
  type SayNode,
  type ExtNode,
} from '@bitcrm/types';

/** What a resolved job code names. */
export interface ResolvedExt {
  dealId: string;
  dealNumber?: string;
  /** Absent when the caller's own number did not identify them. */
  technicianId?: string;
  clientName?: string;
  /** The client's real E.164 — never spoken to the caller. */
  to: string;
  /** The market number the client will see. */
  from: string;
  callerIdSource?: string;
}
import { isWithinBusinessHours } from './business-hours';
import {
  TELEPHONY_CONFIG,
  type TelephonyConfig,
} from '../telephony/telephony.config';
import { Inject, Optional } from '@nestjs/common';
import { CallFlowsService } from '../call-flows/call-flows.service';
import { CallGroupsService } from '../call-groups/call-groups.service';
import { CallsService } from '../calls/calls.service';
import { flowStateKey } from '../call-flows/call-flows.constants';
import {
  ConferenceService,
  confName,
  type InboundLeg,
} from './conference.service';
import { DialInService } from '../exts/dial-in.service';

const VoiceResponse = twilio.twiml.VoiceResponse;

/** Everything a running call needs to keep, pinned for its lifetime. */
interface FlowState {
  /** A snapshot, not a reference: editing the flow mid-call must not move this caller. */
  flow: CallFlow;
  nodeId: string;
  hops: number;
  from: string;
  to: string;
  /** How many times the current menu has re-read itself. */
  menuTries?: number;
  /**
   * Where the technician dial-in has got to. Held in call state rather than
   * wired into the graph because `validateGraph` refuses cycles — a retry
   * cannot be an edge that points back at its own node.
   */
  extStage?: 'code' | 'confirm';
  /**
   * The job code, held until the PIN arrives. BOTH are collected before EITHER
   * is checked: refusing at the code step and refusing at the PIN step are
   * distinguishable by how many prompts the caller heard, and that difference
   * is an oracle that maps live job codes for anyone with a handset.
   */
  extCode?: string;
  /** Failed attempts on this call. */
  extTries?: number;
  /**
   * What the code and PIN resolved to, held across the confirm step so the
   * client is looked up once rather than twice.
   */
  extMatch?: ResolvedExt;
}

const STATE_TTL_SECONDS = 4 * 60 * 60;

/** Parent-call statuses that mean the caller is gone. */
const ENDED_STATUSES = new Set([
  'completed',
  'busy',
  'no-answer',
  'failed',
  'canceled',
]);

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
    @Optional() private readonly dialIn?: DialInService,
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
    void this.calls
      .applyLifecycle({ callSid, flowName: flow.name })
      .catch(() => undefined);
    return this.execute(callSid, state, entry);
  }

  /**
   * The technician dial-in, with no call flow behind it.
   *
   * Designating a number as the technician line is the whole configuration —
   * masking must not also require somebody to build a flow, because the flow
   * would only ever contain this one step. So the step is synthesised here and
   * run through the ordinary machinery.
   *
   * Nothing about the call is special afterwards: `FlowState` pins a snapshot
   * of its flow for the call's lifetime anyway, so a synthesised one resumes
   * across `/voice/flow` webhooks exactly like a stored one.
   *
   * A workspace that WANTS a greeting, business hours, or a custom fallback can
   * still build a flow with a Technician line step; that flow is found first
   * and this never runs.
   */
  async startTechnicianLine(
    callSid: string,
    from: string,
    to: string,
  ): Promise<string> {
    const node: ExtNode = {
      id: 'dial-in',
      type: 'ext',
      prompt: 'Enter the job code.',
      confirmPrompt: 'Calling',
      repeats: CALL_FLOW_LIMITS.extMaxAttempts,
      timeoutSeconds: 10,
    };

    const flow: CallFlow = {
      id: 'built-in-technician-line',
      name: 'Technician line',
      numbers: [to],
      entryNodeId: node.id,
      nodes: { [node.id]: node },
      active: true,
      version: 1,
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const state: FlowState = { flow, nodeId: node.id, hops: 0, from, to };
    await this.save(callSid, state);
    void this.calls
      .applyLifecycle({ callSid, flowName: flow.name })
      .catch(() => undefined);

    this.trace(callSid, node, 'Asked for a job code');
    // Never null: this is the one line where the ring-everyone fallback would
    // hand an unidentified caller to whoever happens to be online.
    return (
      (await this.extPrompt(callSid, state, node, 'code').catch(() => null)) ??
      this.goodbye('Sorry, we could not take that call. Please try again.')
    );
  }

  /** Twilio came back for the next step, optionally with a key the caller pressed. */
  async resume(
    callSid: string,
    nodeId: string,
    digits?: string,
    callStatus?: string,
    afterConversation = false,
  ): Promise<string | null> {
    // A <Dial action> is requested when the dial ends — including when the
    // caller is the one who hung up. Any TwiML returned then is discarded, so
    // running the step would record a greeting nobody could have heard.
    if (callStatus && ENDED_STATUSES.has(callStatus)) {
      this.logger.log(`Flow: ${callSid} already ended (${callStatus}) — nothing to play`);
      return '<Response/>';
    }

    // "After the call" means after a call actually happened. A <Dial> can end
    // without anybody having answered — the ring timed out, the conference was
    // closed — and playing a thank-you to somebody nobody spoke to is worse
    // than saying nothing.
    if (afterConversation) {
      const record = await this.calls.getBySid(callSid).catch(() => null);
      if (!record?.answeredAt) {
        this.logger.log(`Flow: ${callSid} was never answered — skipping the closing step`);
        return '<Response/>';
      }
    }

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

    // A menu answering itself is the one case where the caller's keypress
    // decides the step, so it is resolved before anything is executed.
    if (node.type === 'menu' && digits !== undefined) {
      const chosen = node.options.find((option) => option.key === digits);
      if (chosen) {
        this.trace(
          callSid,
          node,
          `Pressed ${chosen.key}${chosen.label ? ` · ${chosen.label}` : ''}`,
        );
        return this.resume(callSid, chosen.next);
      }
      this.trace(callSid, node, `Pressed ${digits} — not an option`);
      const tries = (state.menuTries ?? 0) + 1;
      if (tries <= node.repeats) {
        await this.save(callSid, { ...state, nodeId, hops: state.hops + 1, menuTries: tries });
        return this.menu(node, true);
      }
      // Out of patience: send them where a caller who pressed nothing goes,
      // rather than leaving them in a menu they evidently can't use.
      if (node.next) return this.resume(callSid, node.next);
      return this.goodbye('Sorry, we did not get that. Please call again.');
    }

    if (node.type === 'ext' && digits !== undefined) {
      return this.extDigits(callSid, state, node, digits);
    }

    const next: FlowState = {
      ...state,
      nodeId,
      hops: state.hops + 1,
      menuTries: node.type === 'menu' ? 0 : state.menuTries,
    };
    await this.save(callSid, next);
    return this.execute(callSid, next, node);
  }

  /* ------------------------------------------------- the technician line */

  /**
   * Ask for the job code.
   *
   * Note what does NOT follow the `<Gather>`: the menu falls through to a
   * `<Redirect>` back at itself, which is an unconditional loop. Here an empty
   * result comes back to the same action URL via `actionOnEmptyResult`, is
   * counted as an attempt, and eventually hands the caller to `next` — so a
   * technician in a bad signal area reaches dispatch instead of a loop.
   */
  private async extPrompt(
    callSid: string,
    state: FlowState,
    node: ExtNode,
    stage: 'code' | 'confirm',
    retry = false,
  ): Promise<string> {
    await this.save(callSid, {
      ...state,
      nodeId: node.id,
      hops: state.hops + 1,
      extStage: stage,
      // Starting the sequence over clears any half-entered code.
      ...(stage === 'code' ? { extCode: undefined } : {}),
    });

    const twiml = new VoiceResponse();
    const gather = twiml.gather({
      numDigits: stage === 'code' ? CALL_FLOW_LIMITS.extDigits : 1,
      timeout: node.timeoutSeconds,
      action: this.stepUrl(node.id),
      method: 'POST',
      // Without this an empty result never reaches us and the caller loops.
      actionOnEmptyResult: true,
    });

    if (retry) gather.say('Sorry, that did not work.');
    if (stage === 'code') {
      if (node.audioId) gather.play({}, this.audioUrl(node.audioId));
      else gather.say(node.prompt || 'Enter the job code, then hash.');
    }
    return twiml.toString();
  }

  /**
   * A keypress arrived for the dial-in. Two stages, and only the last one
   * dials anybody.
   *
   * Every failure — unknown code, expired, closed job, an unreachable
   * deal-service — produces the SAME sentence after the SAME number of
   * prompts. That uniformity is the point: a differentiated refusal turns the
   * line into an oracle that maps live job codes.
   */
  private async extDigits(
    callSid: string,
    state: FlowState,
    node: ExtNode,
    digits: string,
  ): Promise<string> {
    const stage = state.extStage ?? 'code';

    if (stage === 'confirm') {
      if (digits === '1') {
        this.trace(callSid, node, 'Confirmed the client');
        return this.extConnect(callSid, state, node);
      }
      this.trace(callSid, node, 'Did not confirm');
      return this.extRetry(callSid, state, node);
    }

    // stage === 'code'.
    const resolved = await this.resolveExt(digits, state.from);
    if (!resolved) {
      // Truncated on purpose: a failure log must not become an enumeration
      // corpus for whoever can read the logs.
      this.logger.warn(
        `Dial-in refused for ${state.from}: ext=***${digits.slice(-2)}`,
      );
      return this.extRetry(callSid, { ...state, extCode: digits }, node);
    }

    this.trace(callSid, node, `Entered a job code · ${resolved.dealNumber ?? ''}`.trim());
    await this.extPrompt(
      callSid,
      { ...state, extStage: 'confirm', extMatch: resolved },
      node,
      'confirm',
    );
    return this.extConfirmXml(node, resolved);
  }

  /** Re-ask from the top, or hand the caller on once they are out of tries. */
  private async extRetry(
    callSid: string,
    state: FlowState,
    node: ExtNode,
  ): Promise<string> {
    const tries = (state.extTries ?? 0) + 1;
    if (tries >= node.repeats) {
      this.trace(callSid, node, 'Code not accepted');
      // Never a dead end, and never null: returning null drops the caller into
      // buildLegacyInbound, which rings every online softphone — the last
      // place an unauthenticated caller on the technician line should land.
      const onward = node.next ? await this.resume(callSid, node.next) : null;
      return (
        onward ??
        this.goodbye(
          'Sorry, we could not connect that call. Please contact the office.',
        )
      );
    }
    return this.extPrompt(
      callSid,
      { ...state, extTries: tries, extCode: undefined },
      node,
      'code',
      true,
    );
  }

  /**
   * The confirm step, which no competing design had and which addresses the
   * single most likely wrong-client event: a mistyped code that happens to be
   * another live job. The client's NAME is spoken; their number never is.
   */
  private extConfirmXml(node: ExtNode, resolved: ResolvedExt): string {
    const twiml = new VoiceResponse();
    const gather = twiml.gather({
      numDigits: 1,
      timeout: node.timeoutSeconds,
      action: this.stepUrl(node.id),
      method: 'POST',
      actionOnEmptyResult: true,
    });
    const who = resolved.clientName ?? 'the client';
    const job = resolved.dealNumber ? ` about job ${resolved.dealNumber}` : '';
    gather.say(
      node.confirmPrompt?.trim()
        ? `${node.confirmPrompt} ${who}${job}. Press 1 to connect.`
        : `Calling ${who}${job}. This call is recorded. Press 1 to connect.`,
    );
    return twiml.toString();
  }

  /**
   * Resolve a job code.
   *
   * Optional so the flow-runner specs — which are about the STATE MACHINE, not
   * about authorisation — construct without a dial-in service and see every
   * code refuse, which is also what an unknown code does in production.
   */
  protected async resolveExt(
    code: string,
    from: string,
  ): Promise<ResolvedExt | null> {
    if (!this.dialIn) return null;
    try {
      const match = await this.dialIn.resolve(code, from);
      return match ?? null;
    } catch (error) {
      // A throw here would escape `flowStep`, which has no try/catch, and a
      // 500 to Twilio means the caller hears nothing at all.
      this.logger.error(
        `Dial-in resolution failed — refusing: ${this.reason(error)}`,
      );
      return null;
    }
  }

  /**
   * Connect the technician to the client.
   *
   * Lands on the SAME machinery the in-app bridge uses: their inbound leg
   * becomes the primary sid of `conf-<CallSid>`, and the unmodified
   * `onParticipantJoin` dials the client from the market number. Two ways in,
   * one conference, one record, one recording, one job link.
   */
  protected async extConnect(
    callSid: string,
    state: FlowState,
    node: ExtNode,
  ): Promise<string> {
    const match = state.extMatch;
    if (!match || !this.dialIn) return this.extRetry(callSid, state, node);

    try {
      await this.conference.initOutbound(
        callSid,
        match.technicianId ?? '',
        match.to,
        match.from,
        {
          dealId: match.dealId,
          origin: 'bridge',
          callerIdSource: match.callerIdSource as never,
        },
      );
    } catch (error) {
      this.logger.error(`Dial-in connect failed: ${this.reason(error)}`);
      return this.extRetry(callSid, state, node);
    }

    const twiml = new VoiceResponse();
    // Same shape as ring(): the action gives the technician's flow somewhere
    // to resume once the conversation ends.
    const dial = node.answeredNext
      ? twiml.dial({
          action: `${this.stepUrl(node.answeredNext)}&after=1`,
          method: 'POST',
        })
      : twiml.dial();
    dial.conference(
      {
        ...this.conference.sharedConferenceAttrs(),
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        beep: 'false',
      } as Parameters<InstanceType<typeof VoiceResponse.Dial>['conference']>[0],
      confName(callSid),
    );
    return twiml.toString();
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
          this.trace(callSid, node, node.audioId ? 'Played a recording' : node.text);
          return this.say(node, node.next);
        case 'hours':
          return await this.hours(callSid, node);
        case 'menu':
          this.trace(callSid, node, 'Offered the menu');
          return this.menu(node, false);
        case 'hangup':
          this.trace(callSid, node, node.text || 'Ended the call');
          return this.goodbye(node.text);
        case 'voicemail':
          this.trace(callSid, node, 'Took a message');
          return this.voicemail(node.prompt, node.maxSeconds);
        case 'ring':
          return await this.ring(callSid, state, node);
        case 'ext':
          this.trace(callSid, node, 'Asked for a job code');
          return await this.extPrompt(callSid, state, node, 'code');
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

  private say(node: SayNode, next?: string): string {
    const twiml = new VoiceResponse();
    this.speak(twiml, node.text, node.audioId);
    if (next) twiml.redirect({ method: 'POST' }, this.stepUrl(next));
    else twiml.hangup();
    return twiml.toString();
  }

  /** A recorded greeting when there is one, the typed words when there isn't. */
  private speak(
    twiml: InstanceType<typeof VoiceResponse>,
    text?: string,
    audioId?: string,
  ): void {
    if (audioId) twiml.play({}, this.audioUrl(audioId));
    else if (text?.trim()) twiml.say(text);
  }

  /**
   * Open or closed, decided in the flow's own timezone — never the server's.
   */
  private async hours(callSid: string, node: HoursNode): Promise<string | null> {
    const open = isWithinBusinessHours(node, new Date());
    const target = open ? node.openNext : node.next;
    this.trace(callSid, node, open ? 'Open' : 'Closed');
    this.logger.log(
      `Flow hours check: ${open ? 'open' : 'closed'} (${node.timezone})`,
    );
    if (!target) {
      return this.goodbye(
        open ? undefined : 'Sorry, we are closed right now. Please call back during business hours.',
      );
    }
    return this.resume(callSid, target);
  }

  /** "Press 1 for…" — and a way out for somebody who presses nothing. */
  private menu(node: MenuNode, retry: boolean): string {
    const twiml = new VoiceResponse();
    const gather = twiml.gather({
      numDigits: 1,
      timeout: node.timeoutSeconds,
      action: this.stepUrl(node.id),
      method: 'POST',
    });
    if (retry) gather.say('Sorry, I did not get that.');
    // The prompt lives inside <Gather> so a caller who already knows the menu
    // can press their key without waiting for it to finish.
    if (node.audioId) gather.play({}, this.audioUrl(node.audioId));
    else if (node.prompt?.trim()) gather.say(node.prompt);

    // Falls through here when the caller presses nothing at all.
    twiml.redirect({ method: 'POST' }, this.stepUrl(node.id));
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
    node: RingNode,
  ): Promise<string | null> {
    const { groupId, next, answeredNext, whisper } = node;
    const group = await this.groups.findRaw(groupId);
    if (!group) {
      this.logger.error(`Flow step rings group ${groupId}, which is gone — falling back`);
      return null;
    }

    const targets = await this.groups.resolveTargets(group);
    this.trace(
      callSid,
      node,
      targets.length
        ? `Rang ${group.name} — ${targets.length} phone${targets.length === 1 ? '' : 's'}`
        : `${group.name} — nobody reachable`,
    );
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
      // Only a real phone can be answered by voicemail, so only a real phone
      // needs to prove a human is there.
      whisper: !!whisper && target.channel === 'personal',
    }));

    await this.conference.initInbound(callSid, state.from, state.to, legs, {
      ringSeconds: group.ringSeconds,
      noAnswerUrl: next ? this.stepUrl(next) : undefined,
    });

    const twiml = new VoiceResponse();
    // `action` is what lets anything follow the conversation. Without it the
    // TwiML ends with the <Dial>, so the moment the conference closes the
    // caller is simply hung up on — no closing message, nothing.
    const dial = answeredNext
      ? twiml.dial({
          // `after=1` marks this as the post-conversation branch, so it can be
          // skipped when there was no conversation.
          action: `${this.stepUrl(answeredNext)}&after=1`,
          method: 'POST',
        })
      : twiml.dial();
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

  /** Twilio fetches greetings itself, so this URL has to be reachable without a token. */
  private audioUrl(audioId: string): string {
    return `${this.base()}/audio/${encodeURIComponent(audioId)}`;
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

  /**
   * Note that the caller passed through this step. Fire-and-forget: the call
   * matters, the breadcrumb doesn't.
   */
  private trace(callSid: string, node: CallFlowNode, detail?: string): void {
    void this.calls
      .recordFlowStep(callSid, { nodeId: node.id, type: node.type, detail })
      .catch(() => undefined);
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
