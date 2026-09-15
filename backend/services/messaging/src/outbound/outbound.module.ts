import { Inject, Logger, Module, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { SqsConsumerService } from '@bitcrm/shared';
import { AccessModule } from '../api/access/access.module';
import { TwilioModule } from '../common/twilio/twilio.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { OptOutsModule } from '../opt-outs/opt-outs.module';
import { MessagingSettingsModule } from '../settings/messaging-settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessageTemplatesModule } from '../templates/message-templates.module';
import { StatusController } from '../webhooks/status.controller';
import { MESSAGE_TEMPLATE_RENDERER } from './template-renderer';
import { TemplateRendererAdapter } from './template-renderer.adapter';
import { OutboundAttachmentsController } from './attachments/attachments.controller';
import { OutboundAttachmentsService } from './attachments/attachments.service';
import { CrmContactsClient } from './internal/crm-contacts.client';
import { DealContextClient } from './internal/deal-context.client';
import { TelephonyNumbersClient } from './internal/telephony-numbers.client';
import { OUTBOUND_CONFIG, loadOutboundConfig, type OutboundConfig } from './outbound.config';
import { OutboundEventsPublisher } from './outbound-events';
import { OUTBOUND_JOB_EVENT, OutboundQueueProducer } from './outbound-queue.producer';
import { OutboundRepository } from './outbound.repository';
import { OutboundWorker } from './outbound.worker';
import { SendController } from './send.controller';
import { SendService } from './send.service';
import { SenderResolver } from './sender.resolver';
import { StatusCallbackService } from './status-callback.service';

/** The consumer of `messaging-outbound.fifo` — a second `SqsConsumerService`, one queue each. */
export const OUTBOUND_SQS_CONSUMER = Symbol('OUTBOUND_SQS_CONSUMER');

/**
 * Outbound SMS/MMS (design §4.4–4.6, M9 + M10b): the send API, sender
 * selection, the FIFO queue on both ends, Twilio's status callback and the
 * presigned S3 flow for MMS attachments.
 *
 * The consumer follows the AppModule pattern (handlers registered in
 * `onModuleInit`, polling only under `ENABLE_SQS_CONSUMER=true`) but lives
 * here because the outbound queue is this module's own work queue, not an
 * event subscription. Without `MESSAGING_OUTBOUND_QUEUE_URL` the producer
 * hands jobs to the worker in-process, so local dev still sends.
 */
@Module({
  imports: [
    TwilioModule,
    ConversationsModule,
    MessagesModule,
    OptOutsModule,
    MessagingSettingsModule,
    MessageTemplatesModule,
    RealtimeModule,
    // M16: an SMS in an employee's thread goes to their personal phone (user-service).
    AccessModule,
  ],
  controllers: [SendController, OutboundAttachmentsController, StatusController],
  providers: [
    { provide: OUTBOUND_CONFIG, useFactory: loadOutboundConfig },
    // M11 ↔ M9: `templateId` on a send is rendered server-side through the templates module.
    { provide: MESSAGE_TEMPLATE_RENDERER, useClass: TemplateRendererAdapter },
    {
      provide: OUTBOUND_SQS_CONSUMER,
      useFactory: (config: OutboundConfig) =>
        config.queueUrl
          ? new SqsConsumerService({
              region: config.awsRegion,
              endpoint: config.awsEndpoint,
              queueUrl: config.queueUrl,
              waitTimeSeconds: 20,
              maxMessages: 10,
            })
          : null,
      inject: [OUTBOUND_CONFIG],
    },
    TelephonyNumbersClient,
    DealContextClient,
    CrmContactsClient,
    SenderResolver,
    OutboundQueueProducer,
    OutboundEventsPublisher,
    OutboundRepository,
    OutboundAttachmentsService,
    OutboundWorker,
    StatusCallbackService,
    SendService,
  ],
  exports: [SendService, SenderResolver, OutboundQueueProducer, OutboundWorker, OUTBOUND_CONFIG],
})
export class OutboundModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundModule.name);

  constructor(
    private readonly worker: OutboundWorker,
    private readonly producer: OutboundQueueProducer,
    @Inject(OUTBOUND_CONFIG) private readonly config: OutboundConfig,
    @Optional() @Inject(OUTBOUND_SQS_CONSUMER) private readonly consumer?: SqsConsumerService | null,
  ) {}

  onModuleInit() {
    if (this.consumer) {
      this.consumer.registerHandler(OUTBOUND_JOB_EVENT, (payload) => this.worker.handle(payload));
      if (this.config.consumerEnabled) this.consumer.start();
      return;
    }
    this.producer.setInlineHandler((job) => this.worker.process(job));
    this.logger.warn('MESSAGING_OUTBOUND_QUEUE_URL is not set: outbound messages are sent in-process');
  }

  onModuleDestroy() {
    this.consumer?.stop();
  }
}
