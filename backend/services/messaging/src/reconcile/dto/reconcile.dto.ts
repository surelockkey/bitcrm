import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class ReconcileDto {
  @ApiPropertyOptional({
    description: 'Start of the window (ISO-8601). Default: 90 minutes before `until`.',
    example: '2026-09-15T09:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  since?: string;

  @ApiPropertyOptional({ description: 'End of the window (ISO-8601). Default: now.', example: '2026-09-15T10:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  until?: string;

  @ApiPropertyOptional({ description: 'Cap on Twilio records read (safety valve for a wide manual window).', minimum: 1, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;
}
