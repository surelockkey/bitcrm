import { Module, OnModuleInit, Optional } from '@nestjs/common';
import { DynamoDbModule, RedisModule, AuthModule, EventsModule, LoggerModule, SqsConsumerService, MetricsModule, HealthModule, ConnectivityModule, StorageModule } from '@bitcrm/shared';
import { AppController } from './app.controller';
import { StockModule } from './stock/stock.module';
import { ProductsModule } from './products/products.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { ContainersModule } from './containers/containers.module';
import { TransfersModule } from './transfers/transfers.module';
import { ContainersEventHandler } from './containers/containers.event-handler';

@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'inventory-service' }),
    MetricsModule.forRoot({ serviceName: 'inventory-service' }),
    HealthModule.forRoot({
      dynamoTables: [process.env.INVENTORY_TABLE || 'BitCRM_Inventory'],
    }),
    ConnectivityModule.forRoot({
      serviceName: 'inventory-service',
      failFast: [],
      dynamodb: { tables: [process.env.INVENTORY_TABLE || 'BitCRM_Inventory'] },
      redis: true,
      s3: { buckets: [process.env.S3_BUCKET ?? process.env.S3_APP_NAME ?? 'bitcrm-uploads'] },
      sqs: process.env.USER_EVENTS_TO_INVENTORY_QUEUE_URL ? { queues: [process.env.USER_EVENTS_TO_INVENTORY_QUEUE_URL] } : undefined,
    }),
    DynamoDbModule,
    RedisModule,
    AuthModule,
    EventsModule.forRoot({
      consumer: process.env.USER_EVENTS_TO_INVENTORY_QUEUE_URL
        ? {
            region: process.env.AWS_REGION,
            endpoint: process.env.AWS_ENDPOINT,
            queueUrl: process.env.USER_EVENTS_TO_INVENTORY_QUEUE_URL,
            waitTimeSeconds: 20,
            maxMessages: 10,
          }
        : undefined,
    }),
    StorageModule,
    StockModule,
    ProductsModule,
    WarehousesModule,
    ContainersModule,
    TransfersModule,
  ],
  controllers: [AppController],
})
export class AppModule implements OnModuleInit {
  constructor(
    @Optional() private readonly sqsConsumer?: SqsConsumerService,
    @Optional() private readonly containersEventHandler?: ContainersEventHandler,
  ) {}

  onModuleInit() {
    if (!this.sqsConsumer || !this.containersEventHandler) return;

    // Register event handlers
    this.sqsConsumer.registerHandler(
      'user.activated',
      (payload) => this.containersEventHandler!.handleUserEvent(payload as any),
    );
    this.sqsConsumer.registerHandler(
      'user.role-changed',
      (payload) => this.containersEventHandler!.handleUserEvent(payload as any),
    );

    // Only start polling if explicitly enabled (matches deal service convention)
    if (process.env.ENABLE_SQS_CONSUMER === 'true') {
      this.sqsConsumer.start();
    }
  }
}
