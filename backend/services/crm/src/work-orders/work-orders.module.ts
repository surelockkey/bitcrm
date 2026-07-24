import { Module } from '@nestjs/common';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';
import { WorkOrdersRepository } from './work-orders.repository';

@Module({
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService, WorkOrdersRepository],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
