import { IsString, IsOptional, IsBoolean, IsInt, IsIn, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JOB_TAG_COLORS, type JobTagColor } from '@bitcrm/types';

/**
 * Hand-written rather than PartialType(CreateJobTagDto) to match the
 * service-area DTO style, where Swagger documents each field's update rule.
 */
export class UpdateJobTagDto {
  @ApiPropertyOptional({ example: 'Rush' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  name?: string;

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
    description: 'Set false to archive: the tag leaves every picker but still resolves on old deals.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
