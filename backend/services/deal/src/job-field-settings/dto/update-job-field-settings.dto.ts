import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateJobFieldSettingsDto {
  @ApiProperty({
    example: { source: true, poNumber: false },
    description: 'Job field id → required. Ids are validated against the registry.',
  })
  @IsObject()
  requiredFields!: Record<string, boolean>;
}
