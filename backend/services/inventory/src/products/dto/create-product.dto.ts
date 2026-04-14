import {
  IsString,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsOptional,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType } from '@bitcrm/types';

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsString()
  sku!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'Locks > Residential > Deadbolts' })
  @IsString()
  category!: string;

  @ApiProperty({ enum: ProductType })
  @IsEnum(ProductType)
  type!: ProductType;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  costCompany!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  costTech!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  priceClient!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiProperty({ default: false })
  @IsBoolean()
  serialTracking!: boolean;

  @ApiProperty({ default: 0 })
  @IsNumber()
  @Min(0)
  minimumStockLevel!: number;
}
