import { Module } from '@nestjs/common';
import { ItemGroupsController } from './item-groups.controller';
import { ItemGroupsService } from './item-groups.service';
import { ItemGroupsRepository } from './item-groups.repository';

@Module({
  controllers: [ItemGroupsController],
  providers: [ItemGroupsService, ItemGroupsRepository],
  exports: [ItemGroupsService],
})
export class ItemGroupsModule {}
