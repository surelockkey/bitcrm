import { IsString, IsOptional, IsBoolean, IsInt, Max, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JOB_TYPE_DURATION_MAX_MINUTES } from './create-job-type.dto';

/**
 * Hand-written rather than PartialType(CreateJobTypeDto) to match the
 * service-area DTO style, where Swagger documents each field's update rule.
 */
export class UpdateJobTypeDto {
  @ApiPropertyOptional({ example: 'Lock Change' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Set false to archive: the type leaves every picker but still resolves on old deals.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    example: 240,
    description: 'The usual length in minutes (Workiz Duration). 0 clears it: the type has none of its own.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(JOB_TYPE_DURATION_MAX_MINUTES)
  durationMinutes?: number;
}
