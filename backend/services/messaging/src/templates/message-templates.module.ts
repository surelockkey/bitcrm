import { Module } from '@nestjs/common';
import { MessageTemplatesRepository } from './message-templates.repository';

@Module({
  providers: [MessageTemplatesRepository],
  exports: [MessageTemplatesRepository],
})
export class MessageTemplatesModule {}
