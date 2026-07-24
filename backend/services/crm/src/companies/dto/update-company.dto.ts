import {
  IsString, IsOptional, IsEnum, IsArray,
  ArrayMaxSize, MinLength, IsBoolean, IsInt, Min, IsDateString,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ClientType, PaymentTerms } from '@bitcrm/types';

export class UpdateCompanyDto {
  @ApiPropertyOptional({ example: 'New Name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ example: ['(404) 555-9999'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  phones?: string[];

  @ApiPropertyOptional({ example: ['info@acme.com'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emails?: string[];

  @ApiPropertyOptional({ example: '789 New Ave' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'https://newsite.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ enum: ClientType })
  @IsOptional()
  @IsEnum(ClientType)
  clientType?: ClientType;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  // --- Platinum financial terms & compliance (EPIC-9) ---

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPlatinum?: boolean;

  @ApiPropertyOptional({ enum: PaymentTerms })
  @IsOptional()
  @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsInt()
  @Min(1)
  customTermsDays?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  taxExempt?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  poRequired?: boolean;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  coiExpiration?: string;
}
