import { Inject, Logger, Module, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { SqsConsumerService } from '@bitcrm/shared';
import { DealEventType } from '@bitcrm/types';
import { TechScopeModule } from '../tech-scope/tech-scope.module';
import { PushModule } from '../push/push.module';
import { type PushDelivery } from '../push/push-notifier.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { OutboundModule } from '../outbound/outbound.module';
import { MessagingSettingsModule } from '../settings/messaging-settings.module';
import { MessageTemplatesModule } from '../templates/message-templates.module';
import { AUTOMATIONS_CONFIG, loadAutomationsConfig, type AutomationsConfig } from './automations.config';
import { AutomationsController } from './automations.controller';
import { AutomationsRepository } from './automations.repository';
import { AutomationsService } from './automations.service';
import { AutoSentRepository } from './auto-sent.repository';
import {
  CALL_COMPLETED_EVENT,
  DEAL_CREATED_EVENT,
  DEAL_DELETED_EVENT,
  DEAL_SCHEDULED_CHANGED_EVENT,
  DEAL_STATUS_CHANGED_EVENT,
  DEAL_TECH_ASSIGNED_EVENT,
  DEAL_TECH_UNASSIGNED_EVENT,
  DEAL_UPDATED_EVENT,
} from './deal-events';
import { AutomationActionExecutor } from './engine/action-executor';
import { AutomationRunsRepository } from './engine/automation-runs.repository';
import { AutomationDealEventsHandler } from './engine/deal-events.handler';
import { DealSnapshotRepository } from './engine/deal-snapshot.repository';
import { AutomationRuleEngine } from './engine/rule-engine.service';
import { AutomationScheduleRepository } from './engine/schedule.repository';
import { AutomationPeersClient } from './internal/peers.client';
import { NewJobSmsService } from './new-job-sms.service';
import { SendToTechService } from './send-to-tech.service';
import { TeamThreadService } from './team-thread.service';
import { TechNoticesController } from './tech-notices.controller';
import { TechNoticesService } from './tech-notices.service';

/** The consumer of `deal-events-to-messaging` — its own `SqsConsumerService`, one queue each (the outbound-module pattern). */
export const DEAL_EVENTS_SQS_CONSUMER = Symbol('DEAL_EVENTS_SQS_CONSUMER');
/** The consumer of `call-events-to-messaging` — the missed / answered call rules. */
export const CALL_EVENTS_SQS_CONSUMER = Symbol('CALL_EVENTS_SQS_CONSUMER');

/**
 * Automations (design §10 M21): the rules as data and as specs
 * (`GET/PATCH /automations`), the "New job" SMS to technicians, the
 * dispatcher's "Send to tech" delivery (`deal.sent_to_tech`), the
 * technician-triggered "on my way" / "late" texts, and the rule engine —
 * fed by `deal-events-to-messaging` (`deal.created`, `deal.updated`,
 * `deal.status_changed`, `deal.tech_assigned`, `deal.sent_to_tech`, and
 * `deal.scheduled_changed` if deal-service ever publishes it) and
 * `call-events-to-messaging` (`call.completed`), with a minute poller for
 * everything that has to wait.
 *
 * The queue consumers follow the outbound module: handlers registered in
 * `onModuleInit`, polling only under `ENABLE_SQS_CONSUMER=true`, nothing at
 * all without the queue URL. The poller is separate
 * (`ENABLE_AUTOMATION_SCHEDULER=true`) so a machine that consumes events
 * does not also fire timers unless it is meant to.
 */
@Module({
  // TechScopeModule: the technician inbox scope (C4) every job event keeps current.
  // PushModule: the technician app's push notifications, fed by the same job events.
  imports: [ConversationsModule, MessagingSettingsModule, MessageTemplatesModule, OutboundModule, TechScopeModule, PushModule],
  // TechNoticesController first: its `GET /automations/tech-notices` would otherwise be
  // swallowed by AutomationsController's `GET /automations/:id` (routes mount in this order).
  controllers: [TechNoticesController, AutomationsController],
  providers: [
    { provide: AUTOMATIONS_CONFIG, useFactory: loadAutomationsConfig },
    {
      provide: DEAL_EVENTS_SQS_CONSUMER,
      useFactory: (config: AutomationsConfig) =>
        config.dealEventsQueueUrl
          ? new SqsConsumerService({
              region: config.awsRegion,
              endpoint: config.awsEndpoint,
              queueUrl: config.dealEventsQueueUrl,
              waitTimeSeconds: 20,
              maxMessages: 10,
            })
          : null,
      inject: [AUTOMATIONS_CONFIG],
    },
    {
      provide: CALL_EVENTS_SQS_CONSUMER,
      useFactory: (config: AutomationsConfig) =>
        config.callEventsQueueUrl
          ? new SqsConsumerService({
              region: config.awsRegion,
              endpoint: config.awsEndpoint,
              queueUrl: config.callEventsQueueUrl,
              waitTimeSeconds: 20,
              maxMessages: 10,
            })
          : null,
      inject: [AUTOMATIONS_CONFIG],
    },
    AutomationsRepository,
    AutomationsService,
    AutoSentRepository,
    AutomationPeersClient,
    TeamThreadService,
    NewJobSmsService,
    SendToTechService,
    TechNoticesService,
    AutomationRunsRepository,
    AutomationActionExecutor,
    AutomationScheduleRepository,
    DealSnapshotRepository,
    AutomationRuleEngine,
    AutomationDealEventsHandler,
  ],
  exports: [
    AutomationsRepository,
    AutomationsService,
    NewJobSmsService,
    SendToTechService,
    TechNoticesService,
    AutomationRunsRepository,
    AutomationActionExecutor,
    AutomationRuleEngine,
  ],
})
export class AutomationsModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationsModule.name);

  private poller: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly events: AutomationDealEventsHandler,
    private readonly engine: AutomationRuleEngine,
    private readonly sendToTech: SendToTechService,
    @Inject(AUTOMATIONS_CONFIG) private readonly config: AutomationsConfig,
    @Optional() @Inject(DEAL_EVENTS_SQS_CONSUMER) private readonly consumer?: SqsConsumerService | null,
    @Optional() @Inject(CALL_EVENTS_SQS_CONSUMER) private readonly callConsumer?: SqsConsumerService | null,
  ) {}

  onModuleInit() {
    if (this.consumer) {
      // One handler per event type: `SqsConsumerService` keeps a single
      // handler per name, so the built-in SMS, the rule engine and the push
      // notifications are fanned out inside `AutomationDealEventsHandler`.
      // `delivery` (the shared consumer's meta) carries the event id the
      // push notifier's once-per-event claim is keyed on.
      this.consumer.registerHandler(DEAL_CREATED_EVENT, (p, delivery?: PushDelivery) => this.events.onDealCreated(p, delivery));
      this.consumer.registerHandler(DEAL_STATUS_CHANGED_EVENT, (p, delivery?: PushDelivery) => this.events.onDealStatusChanged(p, delivery));
      this.consumer.registerHandler(DEAL_TECH_ASSIGNED_EVENT, (p, delivery?: PushDelivery) => this.events.onTechAssigned(p, delivery));
      this.consumer.registerHandler(DEAL_UPDATED_EVENT, (p, delivery?: PushDelivery) => this.events.onDealUpdated(p, delivery));
      this.consumer.registerHandler(DEAL_SCHEDULED_CHANGED_EVENT, (p) => this.events.onScheduledChanged(p));
      // Not rule triggers: the technician inbox scope (C4) follows roster removals and deletes.
      this.consumer.registerHandler(DEAL_TECH_UNASSIGNED_EVENT, (p, delivery?: PushDelivery) => this.events.onTechUnassigned(p, delivery));
      this.consumer.registerHandler(DEAL_DELETED_EVENT, (p) => this.events.onDealDeleted(p));
      // The client confirmed the visit through {{confirm_link}} (B12): rules only.
      this.consumer.registerHandler(DealEventType.DEAL_CLIENT_CONFIRMED, (p) => this.events.onClientConfirmed(p));
      // "Send to tech" is a delivery, not a rule: it goes straight to its
      // own service and resolves to void whatever the service reports.
      this.consumer.registerHandler(DealEventType.SENT_TO_TECH, async (p) => {
        await this.sendToTech.onSentToTech(p);
      });
      if (this.config.consumerEnabled) this.consumer.start();
    } else {
      this.logger.warn(
        'DEAL_EVENTS_TO_MESSAGING_QUEUE_URL is not set: job automations and "Send to tech" are not fed',
      );
    }

    if (this.callConsumer) {
      this.callConsumer.registerHandler(CALL_COMPLETED_EVENT, (p) => this.events.onCallCompleted(p));
      if (this.config.consumerEnabled) this.callConsumer.start();
    } else {
      this.logger.warn('CALL_EVENTS_TO_MESSAGING_QUEUE_URL is not set: missed-call automations are not fed');
    }

    if (this.config.schedulerEnabled) {
      this.poller = setInterval(() => {
        void this.engine
          .tick()
          .catch((error) => this.logger.error(`Automation scheduler tick failed: ${error?.message ?? error}`));
      }, this.config.schedulerIntervalMs);
      this.poller.unref?.();
      this.logger.log(`Automation scheduler polling every ${this.config.schedulerIntervalMs} ms`);
    }
  }

  onModuleDestroy() {
    this.consumer?.stop();
    this.callConsumer?.stop();
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }
}
