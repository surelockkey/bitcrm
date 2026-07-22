import { IsString, IsOptional, IsBoolean, IsInt, IsIn, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JOB_TAG_COLORS, type JobTagColor } from '@bitcrm/types';

export class CreateJobTagDto {
  @ApiProperty({ example: 'Rush' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ enum: JOB_TAG_COLORS, example: 'amber', description: 'Palette token. Defaults to slate.' })
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
}
