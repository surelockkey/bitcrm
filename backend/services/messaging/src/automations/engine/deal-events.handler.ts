import { Injectable, Logger, Optional } from '@nestjs/common';
import { type CallCompletedEvent } from '@bitcrm/types';
import {
  hasDealId,
  isDealClientConfirmedPayload,
  isDealScheduledChangedPayload,
  isDealStatusChangedPayload,
  isDealTechAssignedPayload,
  isDealTechUnassignedPayload,
  type DealScheduledChangedPayload,
  type DealStatusChangedPayload,
} from '../deal-events';
import { TechScopeService } from '../../tech-scope/tech-scope.service';
import { NewJobSmsService } from '../new-job-sms.service';
import { AutomationPeersClient } from '../internal/peers.client';
import {
  DealSnapshotRepository,
  isReschedule,
  snapshotOf,
  type DealScheduleSnapshot,
} from './deal-snapshot.repository';
import { type AutomationFacts } from './facts';
import { AutomationRuleEngine } from './rule-engine.service';
import { type AutomationEvent } from './trigger-event';

/**
 * The `deal-events-to-messaging` queue (and, once it exists,
 * `call-events-to-messaging`) fanned out to both consumers: the built-in
 * "New job" SMS, which has run since M21's first half, and the rule engine.
 * One handler per event type — `SqsConsumerService` keeps a single handler
 * per name — so the fan-out is explicit and its order is fixed: the
 * built-in first (nothing about its behaviour changes), the engine second.
 *
 * The job is read once here and handed to both halves, and every job event
 * also refreshes the `DEALSNAP#` schedule snapshot: deal-service publishes
 * neither `deal.scheduled_changed` nor the fields a `deal.updated` touched,
 * so a move of the date, end date or slot is detected by comparison and
 * raised as the synthetic event a reschedule rule listens for.
 *
 * Errors propagate: SQS retries, and every path is idempotent (the
 * `AUTOSENT#` marker, the `ONCE#` claim, the `CLIENTMSG#` guard).
 */
@Injectable()
export class AutomationDealEventsHandler {
  private readonly logger = new Logger(AutomationDealEventsHandler.name);

  constructor(
    private readonly newJobSms: NewJobSmsService,
    private readonly engine: AutomationRuleEngine,
    private readonly peers: AutomationPeersClient,
    private readonly snapshots: DealSnapshotRepository,
    @Optional() private readonly techScope?: TechScopeService,
  ) {}

  /** `deal.created`. */
  async onDealCreated(payload: unknown): Promise<void> {
    if (!hasDealId(payload)) return this.drop('deal.created', payload);
    await this.keepTechScope(payload.dealId);
    await this.dispatch({ kind: 'deal.created', at: this.now(), dealId: payload.dealId });
  }

  /** `deal.status_changed` — the sub-status ids are filled from the job by the engine. */
  async onDealStatusChanged(payload: unknown): Promise<void> {
    if (!isDealStatusChangedPayload(payload)) return this.drop('deal.status_changed', payload);
    const p = payload as DealStatusChangedPayload;
    await this.keepTechScope(p.dealId);
    await this.dispatch({
      kind: 'deal.status_changed',
      at: this.now(),
      dealId: p.dealId,
      status: {
        from: p.oldStatus,
        to: p.newStatus,
        fromSubStatusId: p.oldSubStatusId ?? undefined,
        toSubStatusId: p.newSubStatusId ?? undefined,
      },
    });
  }

  /** `deal.tech_assigned` — the built-in New-job SMS, then the rules. */
  async onTechAssigned(payload: unknown): Promise<void> {
    if (isDealTechAssignedPayload(payload)) await this.keepTechScope(payload.dealId, [payload.techId]);
    await this.newJobSms.onTechAssigned(payload);
    if (!isDealTechAssignedPayload(payload)) return;
    await this.dispatch({
      kind: 'deal.tech_assigned',
      at: this.now(),
      dealId: payload.dealId,
      techId: payload.techId,
    });
  }

  /** `deal.updated` — the built-in reschedule text, then the rules (and the reschedule detector). */
  async onDealUpdated(payload: unknown): Promise<void> {
    if (hasDealId(payload)) await this.keepTechScope(payload.dealId);
    await this.newJobSms.onDealUpdated(payload);
    if (!hasDealId(payload)) return;
    await this.dispatch({ kind: 'deal.updated', at: this.now(), dealId: payload.dealId });
  }

  /** `deal.tech_unassigned` — no rule listens; the technician it names leaves the job's inbox scope. */
  async onTechUnassigned(payload: unknown): Promise<void> {
    if (!isDealTechUnassignedPayload(payload)) return this.drop('deal.tech_unassigned', payload);
    await this.keepTechScope(payload.dealId, [payload.techId]);
  }

  /** `deal.deleted` — no rule listens; the job leaves its technicians' inbox scope. */
  async onDealDeleted(payload: unknown): Promise<void> {
    if (!hasDealId(payload)) return this.drop('deal.deleted', payload);
    await this.keepTechScope(payload.dealId);
  }

  /** `deal.scheduled_changed` — not published by deal-service today; honoured if it ever is. */
  async onScheduledChanged(payload: unknown): Promise<void> {
    if (!isDealScheduledChangedPayload(payload)) return this.drop('deal.scheduled_changed', payload);
    const p = payload as DealScheduledChangedPayload;
    await this.dispatch({
      kind: 'deal.scheduled_changed',
      at: this.now(),
      dealId: p.dealId,
      schedule: {
        fromDate: p.from?.scheduledDate,
        fromTimeSlot: p.from?.scheduledTimeSlot,
        toDate: p.to?.scheduledDate,
        toTimeSlot: p.to?.scheduledTimeSlot,
      },
    });
  }

  /**
   * `deal.client_confirmed` — the client confirmed the visit (B12). Only the
   * rules hear it ("client confirmed → tell the dispatcher"); `at` is the
   * confirmation's own moment, so a redelivery is the same occurrence.
   */
  async onClientConfirmed(payload: unknown): Promise<void> {
    if (!isDealClientConfirmedPayload(payload)) return this.drop('deal.client_confirmed', payload);
    await this.dispatch({ kind: 'deal.client_confirmed', at: payload.confirmedAt, dealId: payload.dealId });
  }

  /** `call.completed` from telephony (`call-events-to-messaging`). */
  async onCallCompleted(payload: unknown): Promise<void> {
    // `flowName` / `lineName` are not on the event contract yet; carried
    // through when telephony starts publishing them (`{{call_flow}}`).
    const call = payload as Partial<CallCompletedEvent> & { voicemail?: boolean; flowName?: string; lineName?: string };
    if (!call?.callSid) return this.drop('call.completed', payload);
    const outcome = callOutcome(call.status, call.voicemail);
    const facts: AutomationFacts = {
      call: {
        callSid: call.callSid,
        direction: call.direction,
        status: call.status,
        voicemail: call.voicemail,
        agentId: call.agentId,
        from: call.from,
        to: call.to,
        ...(call.flowName ? { flowName: call.flowName } : {}),
        ...(call.lineName ? { lineName: call.lineName } : {}),
      },
    };
    await this.engine.handle(
      {
        kind: 'call.completed',
        at: call.endedAt ?? this.now(),
        call: { sid: call.callSid, outcome, direction: call.direction },
      },
      facts,
    );
  }

  /**
   * Reads the job once, raises a synthetic reschedule when its schedule
   * moved since we last saw it, and hands both events to the engine.
   */
  private async dispatch(event: AutomationEvent): Promise<void> {
    const deal = event.dealId ? await this.peers.deal(event.dealId) : null;
    const facts: AutomationFacts = deal ? { deal: this.engine.dealFacts(deal) } : {};

    if (facts.deal && event.kind !== 'deal.scheduled_changed') {
      const next = snapshotOf(facts.deal, event.at);
      let previous: DealScheduleSnapshot | null = null;
      try {
        previous = await this.snapshots.get(facts.deal.id);
        await this.snapshots.put(next);
      } catch (error) {
        this.logger.warn(
          `Schedule snapshot for ${facts.deal.id} not updated: ${error instanceof Error ? error.message : error}`,
        );
      }
      if (isReschedule(previous, next)) {
        await this.engine.handle(
          {
            kind: 'deal.scheduled_changed',
            at: event.at,
            dealId: facts.deal.id,
            schedule: {
              fromDate: previous?.scheduledDate,
              fromTimeSlot: previous?.scheduledTimeSlot,
              toDate: next.scheduledDate,
              toTimeSlot: next.scheduledTimeSlot,
            },
          },
          facts,
        );
      }
    }

    await this.engine.handle(event, facts);
  }

  /**
   * The technician inbox scope (C4) follows the job's roster and client.
   * First, so it is current even when an automation fails and SQS retries;
   * `onDealEvent` never throws, so it cannot be the reason for a retry.
   */
  private async keepTechScope(dealId: string, techIds: string[] = []): Promise<void> {
    await this.techScope?.onDealEvent(dealId, techIds);
  }

  private now(): string {
    return new Date().toISOString();
  }

  private drop(eventType: string, payload: unknown): void {
    this.logger.warn(`Dropping malformed ${eventType} payload: ${JSON.stringify(payload)}`);
  }
}

/** Twilio's terminal statuses as the rule model sees them. */
export function callOutcome(status: string | undefined, voicemail?: boolean): 'missed' | 'answered' | 'voicemail' {
  if (voicemail) return 'voicemail';
  return status === 'completed' ? 'answered' : 'missed';
}
