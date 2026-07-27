import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { ProductsCacheService } from './products-cache.service';
import { ProductsTypeBackfill } from './products-type.backfill';

@Module({
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductsRepository,
    ProductsCacheService,
    ProductsTypeBackfill,
  ],
  exports: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
