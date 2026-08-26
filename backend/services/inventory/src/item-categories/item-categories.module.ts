import { Module } from '@nestjs/common';
import { ItemCategoriesController } from './item-categories.controller';
import { ItemCategoriesService } from './item-categories.service';
import { ItemCategoriesRepository } from './item-categories.repository';

@Module({
  controllers: [ItemCategoriesController],
  providers: [ItemCategoriesService, ItemCategoriesRepository],
  exports: [ItemCategoriesService, ItemCategoriesRepository],
})
export class ItemCategoriesModule {}
