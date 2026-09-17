import { Module, OnModuleInit, Optional } from '@nestjs/common';
import {
  AuthModule,
  ConnectivityModule,
  DynamoDbModule,
  EventsModule,
  HealthModule,
  LoggerModule,
  MetricsModule,
  RedisModule,
  SqsConsumerService,
  StorageModule,
} from '@bitcrm/shared';
import { BILLING_EVENT_TOPIC } from '@bitcrm/types';
import { AssetsModule } from './assets/assets.module';
import { BusinessProfileModule } from './business-profile/business-profile.module';
import { BILLING_TABLE } from './common/constants/dynamo.constants';
import { DealEventsModule } from './deal-events/deal-events.module';
import { EstimatesModule } from './estimates/estimates.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PortalModule } from './portal/portal.module';
import { TemplateRenderModule } from './templates/template-render.module';
import { TemplatesModule } from './templates/templates.module';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ENDPOINT = process.env.AWS_ENDPOINT;
const BILLING_EVENTS_TOPIC_ARN = process.env.BILLING_EVENTS_TOPIC_ARN;
const DEAL_EVENTS_QUEUE_URL = process.env.BILLING_DEAL_EVENTS_QUEUE_URL;

/**
 * Composition root. No boot-time table reads: local schema comes from
 * `npm run setup:db`, production from Terraform; the default templates are
 * seeded lazily on first read.
 */
@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'billing-service' }),
    MetricsModule.forRoot({ serviceName: 'billing-service' }),
    HealthModule.forRoot({ dynamoTables: [BILLING_TABLE] }),
    ConnectivityModule.forRoot({
      serviceName: 'billing-service',
      failFast: [],
      dynamodb: { tables: [BILLING_TABLE] },
      redis: true,
      sns: BILLING_EVENTS_TOPIC_ARN ? { topics: [BILLING_EVENTS_TOPIC_ARN] } : undefined,
      sqs: DEAL_EVENTS_QUEUE_URL ? { queues: [DEAL_EVENTS_QUEUE_URL] } : undefined,
      httpServices: [
        { name: 'user', url: (process.env.USER_SERVICE_URL ?? 'http://localhost:4001') + '/api/users/health' },
        { name: 'crm', url: (process.env.CRM_SERVICE_URL ?? 'http://localhost:4002') + '/api/crm/health' },
        { name: 'deal', url: (process.env.DEAL_SERVICE_URL ?? 'http://localhost:4003') + '/api/deals/health' },
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
        source: 'billing-service',
        topicArns: BILLING_EVENTS_TOPIC_ARN ? { [BILLING_EVENT_TOPIC]: BILLING_EVENTS_TOPIC_ARN } : {},
      },
      consumer: DEAL_EVENTS_QUEUE_URL
        ? {
            region: AWS_REGION,
            endpoint: AWS_ENDPOINT,
            queueUrl: DEAL_EVENTS_QUEUE_URL,
            waitTimeSeconds: 20,
            maxMessages: 10,
          }
        : undefined,
    }),
    IntegrationsModule,
    AssetsModule,
    BusinessProfileModule,
    // `POST /templates/render` is registered ahead of the `/templates/:id` routes.
    TemplateRenderModule,
    TemplatesModule,
    InvoicesModule,
    EstimatesModule,
    PortalModule,
    DealEventsModule,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(@Optional() private readonly sqsConsumer?: SqsConsumerService) {}

  onModuleInit() {
    if (!this.sqsConsumer) return;
    // deal-events handlers are registered by DealEventsHandler.onModuleInit.
    if (process.env.ENABLE_SQS_CONSUMER === 'true') {
      this.sqsConsumer.start();
    }
  }
}
