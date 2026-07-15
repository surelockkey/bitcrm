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
import { SearchType } from '@bitcrm/types';
import { AppController } from './app.controller';
import { OpenSearchModule } from './common/opensearch/opensearch.module';
import { SearchModule } from './search/search.module';
import { IndexerModule } from './indexer/indexer.module';
import { IndexerEventHandler } from './indexer/indexer.event-handler';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ENDPOINT = process.env.AWS_ENDPOINT;
const QUEUE_URL = process.env.SEARCH_INDEX_QUEUE_URL;

/** eventType → which index doc it touches and how. */
interface EventRoute {
  eventType: string;
  type: SearchType;
  op: 'upsert' | 'delete';
  idField: string;
}

const EVENT_ROUTES: EventRoute[] = [
  // deal-events
  { eventType: 'deal.created', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.stage_changed', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.completed', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.tech_assigned', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.tech_unassigned', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.product_added', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.product_removed', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.deleted', type: 'deal', op: 'delete', idField: 'dealId' },
  // contact-events (crm)
  { eventType: 'contact.created', type: 'contact', op: 'upsert', idField: 'contactId' },
  { eventType: 'contact.updated', type: 'contact', op: 'upsert', idField: 'contactId' },
  { eventType: 'contact.deleted', type: 'contact', op: 'delete', idField: 'contactId' },
  { eventType: 'company.created', type: 'company', op: 'upsert', idField: 'companyId' },
  { eventType: 'company.updated', type: 'company', op: 'upsert', idField: 'companyId' },
  { eventType: 'company.deleted', type: 'company', op: 'delete', idField: 'companyId' },
  // user-events
  { eventType: 'user.activated', type: 'user', op: 'upsert', idField: 'userId' },
  { eventType: 'user.role-changed', type: 'user', op: 'upsert', idField: 'userId' },
  { eventType: 'tech.approved', type: 'technician', op: 'upsert', idField: 'technicianId' },
  { eventType: 'tech.updated', type: 'technician', op: 'upsert', idField: 'technicianId' },
  // inventory-events (topic added in Phase 2 — inert until inventory publishes)
  { eventType: 'product.created', type: 'product', op: 'upsert', idField: 'productId' },
  { eventType: 'product.updated', type: 'product', op: 'upsert', idField: 'productId' },
  { eventType: 'product.deleted', type: 'product', op: 'delete', idField: 'productId' },
  { eventType: 'warehouse.created', type: 'warehouse', op: 'upsert', idField: 'warehouseId' },
  { eventType: 'warehouse.updated', type: 'warehouse', op: 'upsert', idField: 'warehouseId' },
  { eventType: 'container.created', type: 'container', op: 'upsert', idField: 'containerId' },
  { eventType: 'container.updated', type: 'container', op: 'upsert', idField: 'containerId' },
  { eventType: 'transfer.created', type: 'transfer', op: 'upsert', idField: 'transferId' },
];

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
      httpServices: [
        { name: 'crm', url: (process.env.CRM_SERVICE_URL ?? 'http://localhost:4002') + '/api/crm/health' },
        { name: 'user', url: (process.env.USER_SERVICE_URL ?? 'http://localhost:4001') + '/api/users/health' },
        { name: 'deal', url: (process.env.DEAL_SERVICE_URL ?? 'http://localhost:4003') + '/api/deals/health' },
        { name: 'inventory', url: (process.env.INVENTORY_SERVICE_URL ?? 'http://localhost:4004') + '/api/inventory/health' },
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

    // Only poll when explicitly enabled (mirrors other services / local dev).
    if (process.env.ENABLE_SQS_CONSUMER === 'true') {
      this.sqsConsumer.start();
    }
  }
}
