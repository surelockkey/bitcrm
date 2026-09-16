import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Channels a picker asks for; `any` templates are offered in both. */
export const TEMPLATE_PICKER_CHANNELS = ['sms', 'email'] as const;
export type TemplatePickerChannel = (typeof TEMPLATE_PICKER_CHANNELS)[number];

export class ListMessageTemplatesQueryDto {
  @ApiPropertyOptional({ enum: TEMPLATE_PICKER_CHANNELS, description: 'Only templates usable on this channel (`any` included).' })
  @IsOptional()
  @IsIn(TEMPLATE_PICKER_CHANNELS)
  channel?: TemplatePickerChannel;

  @ApiPropertyOptional({ example: false, description: 'Include archived templates (settings screen).' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
