import { Module } from '@nestjs/common';
import { MessageTemplatesRepository } from './message-templates.repository';
import { MessageTemplatesService } from './message-templates.service';
import { MessageTemplatesController } from './message-templates.controller';

@Module({
  controllers: [MessageTemplatesController],
  providers: [MessageTemplatesRepository, MessageTemplatesService],
  exports: [MessageTemplatesRepository, MessageTemplatesService],
})
export class MessageTemplatesModule {}

/** The name the design (§10, M11) and the outbound path use for this module. */
export { MessageTemplatesModule as TemplatesModule };
