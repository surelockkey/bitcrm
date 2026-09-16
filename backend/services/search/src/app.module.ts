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
import {
  OPENSEARCH_ENDPOINT,
  OPENSEARCH_SERVERLESS,
  SEARCH_INDEX_ALIAS,
} from './common/constants/opensearch.constants';
import { OpenSearchModule } from './common/opensearch/opensearch.module';
import { SearchModule } from './search/search.module';
import { IndexerModule } from './indexer/indexer.module';
import { IndexerEventHandler } from './indexer/indexer.event-handler';
import { CUSTOM_FIELD_EVENTS, EVENT_ROUTES } from './indexer/event-routes';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ENDPOINT = process.env.AWS_ENDPOINT;
const QUEUE_URL = process.env.SEARCH_INDEX_QUEUE_URL;

@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'search-service' }),
    MetricsModule.forRoot({ serviceName: 'search-service' }),
    HealthModule.forRoot({}),
    ConnectivityModule.forRoot({
      serviceName: 'search-service',
      failFast: [],
      redis: true,
      sqs: QUEUE_URL ? { queues: [QUEUE_URL] } : undefined,
      // Unsigned HTTP, so only where no signature is required: the local
      // container, or a self-hosted cluster. Any AWS endpoint — Serverless or a
      // managed domain — needs SigV4 and answers an unsigned probe with 403,
      // which reported the read model down while search was serving fine.
      // Mirrors the test OpenSearchService uses to decide whether to sign.
      // In AWS the real signal is bitcrm_search_query_errors_total and
      // bitcrm_search_index_operations_total{status="error"}, both alerted on.
      opensearch:
        OPENSEARCH_SERVERLESS || /\.amazonaws\.com/.test(OPENSEARCH_ENDPOINT)
          ? undefined
          : { url: OPENSEARCH_ENDPOINT, indices: [SEARCH_INDEX_ALIAS] },
      httpServices: [
        { name: 'crm', url: (process.env.CRM_SERVICE_URL ?? 'http://localhost:4002') + '/api/crm/health' },
        { name: 'user', url: (process.env.USER_SERVICE_URL ?? 'http://localhost:4001') + '/api/users/health' },
        { name: 'deal', url: (process.env.DEAL_SERVICE_URL ?? 'http://localhost:4003') + '/api/deals/health' },
        { name: 'inventory', url: (process.env.INVENTORY_SERVICE_URL ?? 'http://localhost:4004') + '/api/inventory/health' },
        { name: 'messaging', url: (process.env.MESSAGING_SERVICE_URL ?? 'http://localhost:4007') + '/api/messaging/health' },
      ],
    }),
    // search has no DynamoDB of its own, but HealthModule's DynamoDbHealthIndicator
    // needs DynamoDbService injectable (it's @Global). No tables are checked.
    DynamoDbModule,
    OpenSearchModule,
    RedisModule,
    AuthModule,
    EventsModule.forRoot({
      consumer: QUEUE_URL
        ? {
            region: AWS_REGION,
            endpoint: AWS_ENDPOINT,
            queueUrl: QUEUE_URL,
            waitTimeSeconds: 20,
            maxMessages: 10,
          }
        : undefined,
    }),
    SearchModule,
    IndexerModule,
  ],
  controllers: [AppController],
})
export class AppModule implements OnModuleInit {
  constructor(
    @Optional() private readonly sqsConsumer?: SqsConsumerService,
    @Optional() private readonly indexerHandler?: IndexerEventHandler,
  ) {}

  onModuleInit() {
    if (!this.sqsConsumer || !this.indexerHandler) return;

    for (const route of EVENT_ROUTES) {
      this.sqsConsumer.registerHandler(route.eventType, async (payload: any) => {
        const id = payload?.[route.idField];
        if (!id) return;
        if (route.op === 'delete') {
          await this.indexerHandler!.onDelete(route.type, id);
        } else {
          await this.indexerHandler!.onUpsert(route.type, id);
        }
      });
    }

    for (const eventType of CUSTOM_FIELD_EVENTS) {
      this.sqsConsumer.registerHandler(eventType, async () => {
        await this.indexerHandler!.onCustomFieldsChanged();
      });
    }

    // Only poll when explicitly enabled (mirrors other services / local dev).
    if (process.env.ENABLE_SQS_CONSUMER === 'true') {
      this.sqsConsumer.start();
    }
  }
}
