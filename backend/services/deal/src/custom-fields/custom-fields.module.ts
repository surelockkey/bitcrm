import { Module } from '@nestjs/common';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';
import { CustomFieldsRepository } from './custom-fields.repository';
import { InternalHttpService } from '../common/services/internal-http.service';

@Module({
  controllers: [CustomFieldsController],
  // InternalHttpService: a client field's answers are crm's, asked before a delete.
  providers: [CustomFieldsService, CustomFieldsRepository, InternalHttpService],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
