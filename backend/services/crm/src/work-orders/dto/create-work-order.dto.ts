import { IsDateString, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorkOrderDto {
  @ApiProperty({ example: 'WO-2026-11-005' })
  @IsString()
  @MinLength(1)
  woNumber!: string;

  @ApiProperty({ example: 'company-uuid' })
  @IsString()
  @MinLength(1)
  companyId!: string;

  @ApiProperty({ example: '2026-11-05', description: 'Work order date (YYYY-MM-DD).' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ example: 'Replace entry doors, lock installation' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'deal-uuid', description: 'Deal this WO authorized, if already created.' })
  @IsOptional()
  @IsString()
  dealId?: string;
}
