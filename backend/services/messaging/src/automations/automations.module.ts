import { Inject, Logger, Module, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { SqsConsumerService } from '@bitcrm/shared';
import { ConversationsModule } from '../conversations/conversations.module';
import { OutboundModule } from '../outbound/outbound.module';
import { MessagingSettingsModule } from '../settings/messaging-settings.module';
import { MessageTemplatesModule } from '../templates/message-templates.module';
import { AUTOMATIONS_CONFIG, loadAutomationsConfig, type AutomationsConfig } from './automations.config';
import { AutomationsController } from './automations.controller';
import { AutomationsRepository } from './automations.repository';
import { AutomationsService } from './automations.service';
import { AutoSentRepository } from './auto-sent.repository';
import { DEAL_TECH_ASSIGNED_EVENT, DEAL_UPDATED_EVENT } from './deal-events';
import { AutomationActionExecutor } from './engine/action-executor';
import { AutomationRunsRepository } from './engine/automation-runs.repository';
import { AutomationPeersClient } from './internal/peers.client';
import { NewJobSmsService } from './new-job-sms.service';
import { TeamThreadService } from './team-thread.service';
import { TechNoticesController } from './tech-notices.controller';
import { TechNoticesService } from './tech-notices.service';

/** The consumer of `deal-events-to-messaging` — its own `SqsConsumerService`, one queue each (the outbound-module pattern). */
export const DEAL_EVENTS_SQS_CONSUMER = Symbol('DEAL_EVENTS_SQS_CONSUMER');

/**
 * Automations (design §10 M21 minimum): the rules as data
 * (`GET/PATCH /automations`), the "New job" SMS to technicians fed by the
 * `deal-events-to-messaging` queue (`deal.tech_assigned`, `deal.updated`),
 * and the technician-triggered "on my way" / "late" texts. The remaining
 * imported Workiz rules stay data until the rule engine (a later L).
 *
 * The queue consumer follows the outbound module: handlers registered in
 * `onModuleInit`, polling only under `ENABLE_SQS_CONSUMER=true`, nothing
 * at all without `DEAL_EVENTS_TO_MESSAGING_QUEUE_URL`.
 */
@Module({
  imports: [ConversationsModule, MessagingSettingsModule, MessageTemplatesModule, OutboundModule],
  controllers: [AutomationsController, TechNoticesController],
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
    AutomationsRepository,
    AutomationsService,
    AutoSentRepository,
    AutomationPeersClient,
    TeamThreadService,
    NewJobSmsService,
    TechNoticesService,
    AutomationRunsRepository,
    AutomationActionExecutor,
  ],
  exports: [
    AutomationsRepository,
    AutomationsService,
    NewJobSmsService,
    TechNoticesService,
    AutomationRunsRepository,
    AutomationActionExecutor,
  ],
})
export class AutomationsModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationsModule.name);

  constructor(
    private readonly newJobSms: NewJobSmsService,
    @Inject(AUTOMATIONS_CONFIG) private readonly config: AutomationsConfig,
    @Optional() @Inject(DEAL_EVENTS_SQS_CONSUMER) private readonly consumer?: SqsConsumerService | null,
  ) {}

  onModuleInit() {
    if (!this.consumer) {
      this.logger.warn('DEAL_EVENTS_TO_MESSAGING_QUEUE_URL is not set: the New-job SMS automation is not fed');
      return;
    }
    this.consumer.registerHandler(DEAL_TECH_ASSIGNED_EVENT, (payload) => this.newJobSms.onTechAssigned(payload));
    this.consumer.registerHandler(DEAL_UPDATED_EVENT, (payload) => this.newJobSms.onDealUpdated(payload));
    if (this.config.consumerEnabled) this.consumer.start();
  }

  onModuleDestroy() {
    this.consumer?.stop();
  }
}
