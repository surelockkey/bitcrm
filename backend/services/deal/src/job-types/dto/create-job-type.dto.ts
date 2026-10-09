import { IsString, IsOptional, IsBoolean, IsInt, Max, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Workiz's Duration boxes run Days 0–31, Hours 0–23, Minutes 0–59. */
export const JOB_TYPE_DURATION_MAX_MINUTES = 31 * 24 * 60 + 23 * 60 + 59;

export class CreateJobTypeDto {
  @ApiProperty({ example: 'Lock Change' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ example: 10, description: 'Higher sorts first in pickers.' })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ example: true, description: 'Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    example: 120,
    description:
      'How long this kind of job usually takes, in minutes (Workiz Duration: days / hours / minutes). ' +
      '0 or absent: none of its own — pickers fall back to an hour.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(JOB_TYPE_DURATION_MAX_MINUTES)
  durationMinutes?: number;
}
