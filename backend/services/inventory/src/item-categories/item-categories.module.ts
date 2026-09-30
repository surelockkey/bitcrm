import { Module } from '@nestjs/common';
import { ItemCategoriesController } from './item-categories.controller';
import { ItemCategoriesService } from './item-categories.service';
import { ItemCategoriesRepository } from './item-categories.repository';
import { UncategorizedCategorySeed } from './uncategorized.seed';
import { ProductCategoryMover } from '../products/product-category-mover';
import { ProductsRepository } from '../products/products.repository';
import { ProductsCacheService } from '../products/products-cache.service';

@Module({
  controllers: [ItemCategoriesController],
  providers: [
    ItemCategoriesService,
    ItemCategoriesRepository,
    UncategorizedCategorySeed,
    // A rename moves the category's products. ProductsModule imports this
    // module (the Uncategorized seed), so it cannot be imported back; the
    // product data layer is stateless and gets its own instances here.
    ProductCategoryMover,
    ProductsRepository,
    ProductsCacheService,
  ],
  exports: [ItemCategoriesService, ItemCategoriesRepository],
})
export class ItemCategoriesModule {}
