import {
  IsString, IsOptional, IsEnum, IsArray,
  ArrayMaxSize, MinLength, IsBoolean, IsInt, Min, IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientType, PaymentTerms } from '@bitcrm/types';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @MinLength(1)
  title!: string;

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

  @ApiPropertyOptional({ example: '456 Business Ave' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'https://acme.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiProperty({ enum: ClientType, example: ClientType.COMMERCIAL })
  @IsEnum(ClientType)
  clientType!: ClientType;

  @ApiPropertyOptional({ example: 'Key account' })
  @IsOptional()
  @IsString()
  notes?: string;

  // --- Platinum financial terms & compliance (EPIC-9) ---

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPlatinum?: boolean;

  @ApiPropertyOptional({ enum: PaymentTerms, example: PaymentTerms.NET_30 })
  @IsOptional()
  @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional({ example: 45, description: 'Days for CUSTOM payment terms.' })
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
