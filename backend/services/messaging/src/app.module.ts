import { Module, OnModuleInit, Optional } from '@nestjs/common';
import {
  DynamoDbModule,
  RedisModule,
  AuthModule,
  EventsModule,
  SqsConsumerService,
  LoggerModule,
  MetricsModule,
  HealthModule,
  ConnectivityModule,
  StorageModule,
} from '@bitcrm/shared';
import { MESSAGE_EVENT_TOPIC } from '@bitcrm/types';
import { MESSAGING_TABLE } from './common/constants/dynamo.constants';
import { InboxCountersModule } from './counters/inbox-counters.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { OptOutsModule } from './opt-outs/opt-outs.module';
import { MessageTemplatesModule } from './templates/message-templates.module';
import { MessagingSettingsModule } from './settings/messaging-settings.module';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ENDPOINT = process.env.AWS_ENDPOINT;
const MESSAGE_EVENTS_TOPIC_ARN = process.env.MESSAGE_EVENTS_TOPIC_ARN;
const CONTACT_EVENTS_QUEUE_URL = process.env.CONTACT_EVENTS_TO_MESSAGING_QUEUE_URL;

/**
 * Composition root. Deliberately has NO boot-time hook that reads the table:
 * the calls table taught us what a Scan-on-startup does to a partition with
 * millions of rows (design §2.3, telephony `db-setup.service.ts`). Local
 * schema comes from `npm run setup:dynamodb`, production from Terraform.
 */
@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'messaging-service' }),
    MetricsModule.forRoot({ serviceName: 'messaging-service' }),
    HealthModule.forRoot({ dynamoTables: [MESSAGING_TABLE] }),
    ConnectivityModule.forRoot({
      serviceName: 'messaging-service',
      failFast: [],
      dynamodb: { tables: [MESSAGING_TABLE] },
      redis: true,
      sns: MESSAGE_EVENTS_TOPIC_ARN ? { topics: [MESSAGE_EVENTS_TOPIC_ARN] } : undefined,
      sqs: CONTACT_EVENTS_QUEUE_URL ? { queues: [CONTACT_EVENTS_QUEUE_URL] } : undefined,
      httpServices: [
        { name: 'user', url: (process.env.USER_SERVICE_URL ?? 'http://localhost:4001') + '/api/users/health' },
        { name: 'crm', url: (process.env.CRM_SERVICE_URL ?? 'http://localhost:4002') + '/api/crm/health' },
        { name: 'deal', url: (process.env.DEAL_SERVICE_URL ?? 'http://localhost:4003') + '/api/deals/health' },
        { name: 'telephony', url: (process.env.TELEPHONY_SERVICE_URL ?? 'http://localhost:4006') + '/api/telephony/health' },
      ],
    }),
    DynamoDbModule,
    RedisModule,
    AuthModule,
    StorageModule,
    EventsModule.forRoot({
      publisher: {
        region: AWS_REGION,
        endpoint: AWS_ENDPOINT,
        source: 'messaging-service',
        topicArns: MESSAGE_EVENTS_TOPIC_ARN
          ? { [MESSAGE_EVENT_TOPIC]: MESSAGE_EVENTS_TOPIC_ARN }
          : {},
      },
      consumer: CONTACT_EVENTS_QUEUE_URL
        ? {
            region: AWS_REGION,
            endpoint: AWS_ENDPOINT,
            queueUrl: CONTACT_EVENTS_QUEUE_URL,
            waitTimeSeconds: 20,
            maxMessages: 10,
          }
        : undefined,
    }),
    // Domain modules — repositories only for now (M5); controllers land with
    // the inbox API. Collection routes (`/conversations/counters`,
    // `/conversations/by-party`, `/conversations/internal/*`) must be declared
    // before any `GET /conversations/:id` — see CLAUDE.md §4 on route shadowing.
    InboxCountersModule,
    ConversationsModule,
    MessagesModule,
    OptOutsModule,
    MessageTemplatesModule,
    MessagingSettingsModule,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(@Optional() private readonly sqsConsumer?: SqsConsumerService) {}

  onModuleInit() {
    if (!this.sqsConsumer) return;

    // TODO(M7): register `contact.merged` / `contact.updated` handlers that
    // rewrite CONVOF# / ADDR# pointers and merge conversations (EVENTS.md).
    // Nothing is registered yet, so a polled message is logged and dropped.

    // Only start polling if explicitly enabled (e.g. ENABLE_SQS_CONSUMER=true)
    // Prevents noisy errors when LocalStack isn't running in local dev
    if (process.env.ENABLE_SQS_CONSUMER === 'true') {
      this.sqsConsumer.start();
    }
  }
}
