import { Module } from '@nestjs/common';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';
import { CustomFieldsRepository } from './custom-fields.repository';

@Module({
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService, CustomFieldsRepository],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
