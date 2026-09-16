import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CALL_TAG_LIMITS,
  JOB_TAG_COLORS,
  type JobTagColor,
} from '@bitcrm/types';

/**
 * NOTE: telephony-service registers no ValidationPipe, so these decorators
 * document the contract for Scalar but do not run. CallTagsService validates
 * the same rules by hand — keep the two in step.
 */
export class CreateCallTagDto {
  @ApiProperty({ example: 'SPAM CALLER' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CALL_TAG_LIMITS.nameMaxLength)
  name!: string;

  @ApiPropertyOptional({
    enum: JOB_TAG_COLORS,
    example: 'red',
    description: 'Palette token shared with job tags. Defaults to slate.',
  })
  @IsOptional()
  @IsIn(JOB_TAG_COLORS)
  color?: JobTagColor;

  @ApiPropertyOptional({ example: 10, description: 'Higher sorts first in pickers.' })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ example: true, description: 'Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    example: 'workiz:tag:645312',
    description: 'Import provenance; `workiz:tag:<id>` for a Workiz call tag.',
  })
  @IsOptional()
  @IsString()
  externalId?: string;
}

/** Everything is optional — an omitted field keeps its stored value. */
export class UpdateCallTagDto {
  @ApiPropertyOptional({ example: 'SPAM CALLER' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CALL_TAG_LIMITS.nameMaxLength)
  name?: string;

  @ApiPropertyOptional({ enum: JOB_TAG_COLORS, example: 'red' })
  @IsOptional()
  @IsIn(JOB_TAG_COLORS)
  color?: JobTagColor;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({
    example: false,
    description:
      'false archives: the tag leaves every picker but still resolves on old calls; true restores it.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
