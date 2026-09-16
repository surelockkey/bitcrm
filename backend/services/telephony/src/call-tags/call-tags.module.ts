import { Module } from '@nestjs/common';
import { CallTagsController } from './call-tags.controller';
import { CallTagsService } from './call-tags.service';
import { CallTagsRepository } from './call-tags.repository';

@Module({
  controllers: [CallTagsController],
  providers: [CallTagsService, CallTagsRepository],
  exports: [CallTagsService],
})
export class CallTagsModule {}
