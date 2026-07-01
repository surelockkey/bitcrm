import { IsNumber, Min, Max, IsOptional, IsISO8601 } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetCommissionDto {
  @ApiProperty({ example: 40, description: 'Base commission rate (% of profit).' })
  @IsNumber()
  @Min(0)
  @Max(100)
  baseRatePct!: number;

  @ApiPropertyOptional({ example: 3, default: 3, description: 'Credit-card fee % (default 3).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  creditCardFeePct?: number;

  @ApiPropertyOptional({ example: 0, default: 0, description: 'ACH fee % (default 0).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  achFeePct?: number;

  @ApiPropertyOptional({ example: '2026-07-01T00:00:00.000Z', description: 'Effective date (ISO).' })
  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;
}
