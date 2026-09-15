import { Inject, Logger, Module, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { OptOutsModule } from '../opt-outs/opt-outs.module';
import { OutboundEventsPublisher } from '../outbound/outbound-events';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagingSettingsModule } from '../settings/messaging-settings.module';
import { EmailAddressResolver } from './email-address.resolver';
import { EmailMessagesRepository } from './email-messages.repository';
import { EmailOutboundWorker } from './email-outbound.worker';
import { EmailSender, SES_CLIENT } from './email-sender';
import { EMAIL_CONFIG, loadEmailConfig, type EmailConfig } from './email.config';
import { EmailDirectory } from './inbound/email-directory';
import { EmailThreadResolver } from './inbound/email-thread.resolver';
import { InboundEmailConsumer } from './inbound/inbound-email.consumer';
import { InboundEmailService } from './inbound/inbound-email.service';
import { RawMailStore } from './inbound/raw-mail.store';
import { SesEventsHandler } from './ses-events.handler';
import { SqsPoller } from './sqs-poller';

/** The `messaging-email-events` poller — `null` when `MESSAGING_EMAIL_EVENTS_QUEUE_URL` is unset. */
export const EMAIL_EVENTS_POLLER = Symbol('EMAIL_EVENTS_POLLER');
/** The `messaging-inbound-email` poller — `null` when `MESSAGING_INBOUND_EMAIL_QUEUE_URL` is unset. */
export const INBOUND_EMAIL_POLLER = Symbol('INBOUND_EMAIL_POLLER');

/**
 * Email over SES (design §5, M17 + M18): the sender-address rules, the SES
 * v2 call with raw MIME for small attachments, the send worker
 * `OutboundWorker` hands `email` jobs to, the consumer of SES delivery
 * events, and the inbound pipeline (receipt rule → S3 → SQS → MIME parse →
 * thread resolution → the same conversation feed as SMS).
 *
 * Deliberately does not import `OutboundModule` (which imports this one for
 * the worker hand-off): the one stateless outbound helper it needs —
 * `OutboundEventsPublisher` — is provided here as a second instance instead
 * of closing a module cycle. Every AWS client is built from `EMAIL_CONFIG`;
 * the SES client never talks to AWS until a mail is sent, and each poller is
 * constructed only when its queue URL is set and polls only under
 * `ENABLE_SQS_CONSUMER=true`, like every consumer in the platform.
 */
@Module({
  imports: [ConversationsModule, MessagesModule, OptOutsModule, MessagingSettingsModule, RealtimeModule],
  providers: [
    { provide: EMAIL_CONFIG, useFactory: loadEmailConfig },
    {
      provide: SES_CLIENT,
      useFactory: (config: EmailConfig) =>
        new SESv2Client({
          region: config.awsRegion,
          ...(config.awsEndpoint && {
            endpoint: config.awsEndpoint,
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }),
        }),
      inject: [EMAIL_CONFIG],
    },
    OutboundEventsPublisher,
    EmailMessagesRepository,
    EmailAddressResolver,
    EmailSender,
    EmailOutboundWorker,
    SesEventsHandler,
    {
      provide: EMAIL_EVENTS_POLLER,
      useFactory: (config: EmailConfig, handler: SesEventsHandler) =>
        config.eventsQueueUrl
          ? new SqsPoller(
              { queueUrl: config.eventsQueueUrl, region: config.awsRegion, endpoint: config.awsEndpoint },
              (body) => handler.handle(body).then(() => undefined),
            )
          : null,
      inject: [EMAIL_CONFIG, SesEventsHandler],
    },
    // M18: inbound mail
    RawMailStore,
    EmailDirectory,
    EmailThreadResolver,
    InboundEmailService,
    InboundEmailConsumer,
    {
      provide: INBOUND_EMAIL_POLLER,
      useFactory: (config: EmailConfig, consumer: InboundEmailConsumer) =>
        config.inboundQueueUrl
          ? new SqsPoller(
              // Each mail is fetched from S3 and parsed; keep a batch small.
              { queueUrl: config.inboundQueueUrl, region: config.awsRegion, endpoint: config.awsEndpoint, maxMessages: 5 },
              (body) => consumer.handle(body),
            )
          : null,
      inject: [EMAIL_CONFIG, InboundEmailConsumer],
    },
  ],
  exports: [EMAIL_CONFIG, EmailAddressResolver, EmailSender, EmailOutboundWorker, SesEventsHandler, InboundEmailService],
})
export class EmailModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailModule.name);

  constructor(
    @Inject(EMAIL_CONFIG) private readonly config: EmailConfig,
    @Optional() @Inject(EMAIL_EVENTS_POLLER) private readonly eventsPoller?: SqsPoller | null,
    @Optional() @Inject(INBOUND_EMAIL_POLLER) private readonly inboundPoller?: SqsPoller | null,
  ) {}

  onModuleInit() {
    if (!this.config.fromAddress) {
      this.logger.warn('MESSAGING_EMAIL_FROM is not set: channel "email" answers 501 until it is');
    }
    if (!this.config.consumerEnabled) return;
    this.eventsPoller?.start();
    this.inboundPoller?.start();
  }

  onModuleDestroy() {
    this.eventsPoller?.stop();
    this.inboundPoller?.stop();
  }
}
