import { Module } from '@nestjs/common';
import { ItemCategoriesController } from './item-categories.controller';
import { ItemCategoriesService } from './item-categories.service';
import { ItemCategoriesRepository } from './item-categories.repository';
import { UncategorizedCategorySeed } from './uncategorized.seed';

@Module({
  controllers: [ItemCategoriesController],
  providers: [ItemCategoriesService, ItemCategoriesRepository, UncategorizedCategorySeed],
  exports: [ItemCategoriesService, ItemCategoriesRepository],
})
export class ItemCategoriesModule {}
