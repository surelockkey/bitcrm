import { IsOptional, IsEnum, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TECHNICIAN_STATUSES } from './update-technician-operational.dto';

export class ListTechniciansQueryDto {
  @ApiPropertyOptional({
    enum: TECHNICIAN_STATUSES,
    description: 'Filter by onboarding status.',
  })
  @IsOptional()
  @IsEnum(TECHNICIAN_STATUSES)
  status?: (typeof TECHNICIAN_STATUSES)[number];

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Opaque pagination cursor.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
