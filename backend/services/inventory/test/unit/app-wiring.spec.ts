import { Test } from '@nestjs/testing';
import { DynamoDbModule, DynamoDbService, RedisModule, RedisService, StorageModule, S3Service, KmsService } from '@bitcrm/shared';
import { InventoryLogModule } from 'src/inventory-log/inventory-log.module';
import { StockModule } from 'src/stock/stock.module';
import { ProductsModule } from 'src/products/products.module';
import { WarehousesModule } from 'src/warehouses/warehouses.module';
import { UserContainersModule } from 'src/user-containers/user-containers.module';
import { ContainerTemplatesModule } from 'src/container-templates/container-templates.module';
import { ContainersModule } from 'src/containers/containers.module';
import { TransfersModule } from 'src/transfers/transfers.module';
import { ItemCategoriesModule } from 'src/item-categories/item-categories.module';
import { BrandsModule } from 'src/brands/brands.module';
import { ContainersService } from 'src/containers/containers.service';
import { TransfersService } from 'src/transfers/transfers.service';
import { ProductStockService } from 'src/stock/product-stock.service';
import { UserContainersService } from 'src/user-containers/user-containers.service';
import { ContainerTemplatesService } from 'src/container-templates/container-templates.service';

/**
 * The service specs build each class with mocks, so none of them would notice
 * a provider no module exports or a cycle between modules — both only fail
 * when the real app boots. This compiles the domain modules the way
 * AppModule composes them, with the infrastructure clients swapped out.
 */
describe('inventory module graph', () => {
  it('resolves every domain provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DynamoDbModule,
        RedisModule,
        StorageModule,
        InventoryLogModule,
        StockModule,
        ProductsModule,
        WarehousesModule,
        UserContainersModule,
        ContainerTemplatesModule,
        ContainersModule,
        TransfersModule,
        ItemCategoriesModule,
        BrandsModule,
      ],
    })
      .overrideProvider(DynamoDbService)
      .useValue({ client: { send: jest.fn() } })
      .overrideProvider(RedisService)
      .useValue({ client: { get: jest.fn(), set: jest.fn(), del: jest.fn() } })
      .overrideProvider(S3Service)
      .useValue({})
      .overrideProvider(KmsService)
      .useValue({})
      .compile();

    for (const provider of [
      ContainersService,
      TransfersService,
      ProductStockService,
      UserContainersService,
      ContainerTemplatesService,
    ]) {
      expect(moduleRef.get(provider, { strict: false })).toBeInstanceOf(provider);
    }
    await moduleRef.close();
  });
});
