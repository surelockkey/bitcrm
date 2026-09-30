import { Module } from '@nestjs/common';
import { DynamoDbModule, RedisModule, AuthModule, EventsModule, LoggerModule, MetricsModule, HealthModule, ConnectivityModule, StorageModule } from '@bitcrm/shared';
import { AppController } from './app.controller';
import { InventoryLogModule } from './inventory-log/inventory-log.module';
import { InventoryUsageModule } from './inventory-usage/inventory-usage.module';
import { StockModule } from './stock/stock.module';
import { ProductsModule } from './products/products.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { ContainersModule } from './containers/containers.module';
import { TransfersModule } from './transfers/transfers.module';
import { ItemCategoriesModule } from './item-categories/item-categories.module';
import { BrandsModule } from './brands/brands.module';
import { UserContainersModule } from './user-containers/user-containers.module';
import { ContainerTemplatesModule } from './container-templates/container-templates.module';

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
    }),
    DynamoDbModule,
    RedisModule,
    AuthModule,
    EventsModule.forRoot({
      publisher: {
        region: process.env.AWS_REGION,
        endpoint: process.env.AWS_ENDPOINT,
        source: 'inventory-service',
        topicArns: process.env.INVENTORY_EVENTS_TOPIC_ARN
          ? { 'inventory-events': process.env.INVENTORY_EVENTS_TOPIC_ARN }
          : {},
      },
      // No consumer: containers are created manually now, so inventory no
      // longer listens to user events for auto-provisioning.
    }),
    StorageModule,
    // Global, ahead of the domain modules that write to them.
    InventoryLogModule,
    InventoryUsageModule,
    StockModule,
    ProductsModule,
    WarehousesModule,
    // Global (the container a user works from), and before ContainersModule so
    // `/containers/:id/users` is registered ahead of any `/containers/:id…`.
    UserContainersModule,
    ContainerTemplatesModule,
    ContainersModule,
    TransfersModule,
    ItemCategoriesModule,
    BrandsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
