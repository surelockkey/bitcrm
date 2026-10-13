import { Module } from '@nestjs/common';
import { ProductListController } from './product-list.controller';
import { ProductListService } from './product-list.service';
import { ProductListReadiness } from './product-list.readiness';

/**
 * Inventory's filtered Price Book off the read model: the internal query
 * route and the readiness flag the product backfill stamps.
 */
@Module({
  controllers: [ProductListController],
  providers: [ProductListService, ProductListReadiness],
  exports: [ProductListReadiness],
})
export class ProductListModule {}
