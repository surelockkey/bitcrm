import { Module, OnModuleInit } from '@nestjs/common';
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
      failFast: ['dynamodb', 'redis'],
      dynamodb: { tables: ['BitCRM_Inventory'] },
      redis: true,
      s3: { buckets: [process.env.S3_BUCKET ?? 'bitcrm-uploads'] },
      sns: { topics: ['bitcrm-inventory-events'] },
      sqs: { queues: ['inventory-user-events'] },
    }),
    DynamoDbModule,
    RedisModule,
    AuthModule,
    EventsModule.forRoot({
      consumer: {
        region: process.env.AWS_REGION,
        endpoint: process.env.AWS_ENDPOINT,
        queueUrl: process.env.AWS_ENDPOINT
          ? `${process.env.AWS_ENDPOINT}/000000000000/inventory-user-events`
          : 'https://sqs.us-east-1.amazonaws.com/000000000000/inventory-user-events',
        waitTimeSeconds: 20,
        maxMessages: 10,
      },
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
    private readonly sqsConsumer: SqsConsumerService,
    private readonly containersEventHandler: ContainersEventHandler,
  ) {}

  onModuleInit() {
    // Register event handlers
    this.sqsConsumer.registerHandler(
      'user.activated',
      (payload) => this.containersEventHandler.handleUserEvent(payload as any),
    );
    this.sqsConsumer.registerHandler(
      'user.role-changed',
      (payload) => this.containersEventHandler.handleUserEvent(payload as any),
    );

    // Start polling
    this.sqsConsumer.start();
  }
}
