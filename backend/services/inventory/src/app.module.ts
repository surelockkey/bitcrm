import { Module, OnModuleInit, Optional } from '@nestjs/common';
import { DynamoDbModule, RedisModule, AuthModule, EventsModule, LoggerModule, SqsConsumerService, MetricsModule, HealthModule, ConnectivityModule } from '@bitcrm/shared';
import { AppController } from './app.controller';
import { S3Module } from './common/s3/s3.module';
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
    HealthModule,
    ConnectivityModule.forRoot({
      serviceName: 'inventory-service',
      failFast: [],
      dynamodb: { tables: [process.env.INVENTORY_TABLE || 'BitCRM_Inventory'] },
      redis: true,
      s3: { buckets: [process.env.S3_BUCKET ?? process.env.S3_APP_NAME ?? 'bitcrm-uploads'] },
      sns: process.env.INVENTORY_EVENTS_TOPIC_ARN ? { topics: [process.env.INVENTORY_EVENTS_TOPIC_ARN] } : undefined,
      sqs: process.env.INVENTORY_USER_QUEUE_URL ? { queues: [process.env.INVENTORY_USER_QUEUE_URL] } : undefined,
    }),
    DynamoDbModule,
    RedisModule,
    AuthModule,
    EventsModule.forRoot({
      consumer: process.env.INVENTORY_USER_QUEUE_URL
        ? {
            region: process.env.AWS_REGION,
            endpoint: process.env.AWS_ENDPOINT,
            queueUrl: process.env.INVENTORY_USER_QUEUE_URL,
            waitTimeSeconds: 20,
            maxMessages: 10,
          }
        : undefined,
    }),
    S3Module,
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
