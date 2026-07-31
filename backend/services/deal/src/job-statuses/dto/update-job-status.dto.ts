import {
  IsString, IsOptional, IsBoolean, IsInt, IsIn, IsEnum, MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JOB_TAG_COLORS, type JobTagColor, DealStageGroup } from '@bitcrm/types';

/**
 * Hand-written rather than PartialType(CreateJobStatusDto) to match the sibling
 * catalog DTOs, where Swagger documents each field's update rule.
 */
export class UpdateJobStatusDto {
  @ApiPropertyOptional({ example: 'Will Call Back' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ enum: DealStageGroup, description: 'Move the sub-status under a different super-status.' })
  @IsOptional()
  @IsEnum(DealStageGroup)
  group?: DealStageGroup;

  @ApiPropertyOptional({ enum: JOB_TAG_COLORS, example: 'amber' })
  @IsOptional()
  @IsIn(JOB_TAG_COLORS)
  color?: JobTagColor;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Set false to archive: the status leaves every picker but still resolves on old deals.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
