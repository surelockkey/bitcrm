import { PartialType } from '@nestjs/swagger';
import { CreateContainerTemplateDto } from './create-container-template.dto';

export class UpdateContainerTemplateDto extends PartialType(
  CreateContainerTemplateDto,
) {}
