import { Module } from '@nestjs/common';
import { ItemAttributesController } from './item-attributes.controller';
import { ItemAttributesService } from './item-attributes.service';
import { ItemAttributesRepository } from './item-attributes.repository';
import { ProductsCacheService } from '../products/products-cache.service';

@Module({
  controllers: [ItemAttributesController],
  providers: [
    ItemAttributesService,
    ItemAttributesRepository,
    // A rename or delete rewrites items; their cached copies are dropped.
    // ProductsModule imports this module (it checks the names an item edit
    // sends), so the stateless cache gets its own instance here, the way
    // ItemCategoriesModule does it.
    ProductsCacheService,
  ],
  exports: [ItemAttributesService, ItemAttributesRepository],
})
export class ItemAttributesModule {}
