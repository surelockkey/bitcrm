import { Module, OnModuleInit, Optional } from '@nestjs/common';
import {
  DynamoDbModule,
  RedisModule,
  GeocodingModule,
  AuthModule,
  LoggerModule,
  EventsModule,
  SqsConsumerService,
  MetricsModule,
  HealthModule,
  ConnectivityModule,
} from '@bitcrm/shared';
import { UserEventType } from '@bitcrm/types';
import { AppController } from './app.controller';
import { DealsModule } from './deals/deals.module';
import { DealsEventHandler } from './deals/deals.event-handler';
import { ServiceAreasModule } from './service-areas/service-areas.module';
import { JobTypesModule } from './job-types/job-types.module';
import { TechnicianEligibilityModule } from './technician-eligibility/technician-eligibility.module';
import { TechnicianEligibilityEventHandler } from './technician-eligibility/technician-eligibility.event-handler';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ENDPOINT = process.env.AWS_ENDPOINT;

@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'deal-service' }),
    MetricsModule.forRoot({ serviceName: 'deal-service' }),
    HealthModule.forRoot({
      dynamoTables: [process.env.DEALS_TABLE || 'BitCRM_Deals'],
    }),
    ConnectivityModule.forRoot({
      serviceName: 'deal-service',
      failFast: [],
      dynamodb: { tables: [process.env.DEALS_TABLE || 'BitCRM_Deals'] },
      redis: true,
      sns: process.env.DEAL_EVENTS_TOPIC_ARN ? { topics: [process.env.DEAL_EVENTS_TOPIC_ARN] } : undefined,
      sqs: process.env.USER_EVENTS_TO_DEAL_QUEUE_URL ? { queues: [process.env.USER_EVENTS_TO_DEAL_QUEUE_URL] } : undefined,
      httpServices: [
        { name: 'crm', url: (process.env.CRM_SERVICE_URL ?? 'http://localhost:4002') + '/api/crm/health' },
        { name: 'user', url: (process.env.USER_SERVICE_URL ?? 'http://localhost:4001') + '/api/users/health' },
        { name: 'inventory', url: (process.env.INVENTORY_SERVICE_URL ?? 'http://localhost:4004') + '/api/inventory/health' },
      ],
    }),
    DynamoDbModule,
    RedisModule,
    GeocodingModule,
    AuthModule,
    EventsModule.forRoot({
      publisher: {
        region: AWS_REGION,
        endpoint: AWS_ENDPOINT,
        source: 'deal-service',
        topicArns: process.env.DEAL_EVENTS_TOPIC_ARN
          ? { 'deal-events': process.env.DEAL_EVENTS_TOPIC_ARN }
          : {},
      },
      consumer: process.env.USER_EVENTS_TO_DEAL_QUEUE_URL
        ? {
            region: AWS_REGION,
            endpoint: AWS_ENDPOINT,
            queueUrl: process.env.USER_EVENTS_TO_DEAL_QUEUE_URL,
            waitTimeSeconds: 20,
            maxMessages: 10,
          }
        : undefined,
    }),
    // The catalog modules must register before DealsModule: their collection
    // routes (GET /service-areas, GET /job-types) would otherwise be shadowed by
    // DealsController's `GET /:id` under the shared `api/deals` prefix.
    ServiceAreasModule,
    JobTypesModule,
    DealsModule,
    TechnicianEligibilityModule,
  ],
  controllers: [AppController],
})
export class AppModule implements OnModuleInit {
  constructor(
    @Optional() private readonly sqsConsumer?: SqsConsumerService,
    @Optional() private readonly dealsEventHandler?: DealsEventHandler,
    @Optional() private readonly eligibilityHandler?: TechnicianEligibilityEventHandler,
  ) {}

  onModuleInit() {
    if (!this.sqsConsumer) return;

    if (this.dealsEventHandler) {
      this.sqsConsumer.registerHandler(
        'payment.received',
        (p) => this.dealsEventHandler!.handlePaymentReceived(p),
      );
      this.sqsConsumer.registerHandler(
        'contact.merged',
        (p) => this.dealsEventHandler!.handleContactMerged(p),
      );
    }

    if (this.eligibilityHandler) {
      this.sqsConsumer.registerHandler(
        UserEventType.TECH_APPROVED,
        (p) => this.eligibilityHandler!.handleTechApproved(p as never),
      );
      this.sqsConsumer.registerHandler(
        UserEventType.TECH_UPDATED,
        (p) => this.eligibilityHandler!.handleTechUpdated(p as never),
      );
    }

    // Only start polling if explicitly enabled (e.g. ENABLE_SQS_CONSUMER=true)
    // Prevents noisy errors when LocalStack isn't running in local dev
    if (process.env.ENABLE_SQS_CONSUMER === 'true') {
      this.sqsConsumer.start();
    }
  }
}
