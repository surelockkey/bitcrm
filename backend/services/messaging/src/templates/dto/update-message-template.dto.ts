import { PartialType } from '@nestjs/swagger';
import { CreateMessageTemplateDto } from './create-message-template.dto';

/** Every field optional; absent fields keep their stored value. */
export class UpdateMessageTemplateDto extends PartialType(CreateMessageTemplateDto) {}
