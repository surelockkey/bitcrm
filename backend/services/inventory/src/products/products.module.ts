import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductThumbnailsService } from './product-thumbnails';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { ProductsCacheService } from './products-cache.service';
import { ProductsTypeBackfill } from './products-type.backfill';
import { ItemCategoriesModule } from '../item-categories/item-categories.module';

@Module({
  // Products seed the `Uncategorized` catalog row on demand (see ProductsService).
  imports: [ItemCategoriesModule],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductsRepository,
    ProductsCacheService,
    ProductsTypeBackfill,
    ProductThumbnailsService,
  ],
  exports: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
