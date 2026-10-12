import { Module } from '@nestjs/common';
import { ItemGroupsController } from './item-groups.controller';
import { ItemGroupsService } from './item-groups.service';
import { ItemGroupsRepository } from './item-groups.repository';
import { ProductsModule } from '../products/products.module';
import { ItemCategoriesModule } from '../item-categories/item-categories.module';

@Module({
  // A group's items must be in the price book, and its category in the catalog.
  imports: [ProductsModule, ItemCategoriesModule],
  controllers: [ItemGroupsController],
  providers: [ItemGroupsService, ItemGroupsRepository],
  exports: [ItemGroupsService],
})
export class ItemGroupsModule {}
