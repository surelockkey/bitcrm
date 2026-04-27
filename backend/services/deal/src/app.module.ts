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
      failFast: ['dynamodb', 'redis'],
      dynamodb: { tables: ['BitCRM_Deals'] },
      redis: true,
      sns: { topics: ['bitcrm-deal-events'] },
      sqs: { queues: ['deal-service-events'] },
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
        topicArns: {
          'deal-events': AWS_ENDPOINT
            ? `arn:aws:sns:${AWS_REGION}:000000000000:bitcrm-deal-events`
            : `arn:aws:sns:${AWS_REGION}:${process.env.AWS_ACCOUNT_ID || '000000000000'}:bitcrm-deal-events`,
        },
      },
      consumer: {
        region: AWS_REGION,
        endpoint: AWS_ENDPOINT,
        queueUrl: AWS_ENDPOINT
          ? `${AWS_ENDPOINT}/000000000000/deal-service-events`
          : `https://sqs.${AWS_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID || '000000000000'}/deal-service-events`,
        waitTimeSeconds: 20,
        maxMessages: 10,
      },
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
