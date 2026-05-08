import { Module, OnModuleInit, Optional } from '@nestjs/common';
import {
  DynamoDbModule,
  RedisModule,
  AuthModule,
  LoggerModule,
  EventsModule,
  SqsConsumerService,
  MetricsModule,
  HealthModule,
  ConnectivityModule,
} from '@bitcrm/shared';
import { AppController } from './app.controller';
import { DealsModule } from './deals/deals.module';
import { DealsEventHandler } from './deals/deals.event-handler';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ENDPOINT = process.env.AWS_ENDPOINT;

@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'deal-service' }),
    MetricsModule.forRoot({ serviceName: 'deal-service' }),
    HealthModule,
    ConnectivityModule.forRoot({
      serviceName: 'deal-service',
      failFast: [],
      dynamodb: { tables: [process.env.DEALS_TABLE || 'BitCRM_Deals'] },
      redis: true,
      sns: process.env.DEAL_EVENTS_TOPIC_ARN ? { topics: [process.env.DEAL_EVENTS_TOPIC_ARN] } : undefined,
      sqs: process.env.DEAL_SERVICE_QUEUE_URL ? { queues: [process.env.DEAL_SERVICE_QUEUE_URL] } : undefined,
      httpServices: [
        { name: 'crm', url: (process.env.CRM_SERVICE_URL ?? 'http://localhost:4002') + '/api/crm/health' },
        { name: 'user', url: (process.env.USER_SERVICE_URL ?? 'http://localhost:4001') + '/api/users/health' },
        { name: 'inventory', url: (process.env.INVENTORY_SERVICE_URL ?? 'http://localhost:4004') + '/api/inventory/health' },
      ],
    }),
    DynamoDbModule,
    RedisModule,
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
      consumer: process.env.DEAL_SERVICE_QUEUE_URL
        ? {
            region: AWS_REGION,
            endpoint: AWS_ENDPOINT,
            queueUrl: process.env.DEAL_SERVICE_QUEUE_URL,
            waitTimeSeconds: 20,
            maxMessages: 10,
          }
        : undefined,
    }),
    DealsModule,
  ],
  controllers: [AppController],
})
export class AppModule implements OnModuleInit {
  constructor(
    @Optional() private readonly sqsConsumer?: SqsConsumerService,
    @Optional() private readonly dealsEventHandler?: DealsEventHandler,
  ) {}

  onModuleInit() {
    if (!this.sqsConsumer || !this.dealsEventHandler) return;

    this.sqsConsumer.registerHandler(
      'payment.received',
      (p) => this.dealsEventHandler!.handlePaymentReceived(p),
    );
    this.sqsConsumer.registerHandler(
      'contact.merged',
      (p) => this.dealsEventHandler!.handleContactMerged(p),
    );

    // Only start polling if explicitly enabled (e.g. ENABLE_SQS_CONSUMER=true)
    // Prevents noisy errors when LocalStack isn't running in local dev
    if (process.env.ENABLE_SQS_CONSUMER === 'true') {
      this.sqsConsumer.start();
    }
  }
}
