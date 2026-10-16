import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ProductType } from '@bitcrm/types';

export class EstimateItemDto {
  @ApiProperty({ example: 'product-uuid' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiPropertyOptional({ enum: ProductType })
  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @ApiProperty({ example: 'Kwikset Deadbolt' })
  @IsString()
  @MaxLength(300)
  name!: string;

  @ApiProperty({ example: 'KW-DB-001' })
  @IsString()
  @MaxLength(120)
  sku!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // A job line is at least 1 (deal-service AddDealProductDto / replace-all);
  // anything less could be saved here but never synced to the job.
  @ApiProperty({ example: 1, minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  // Any price, below zero too — a credit line, as a job line may be
  // (deal-service AddDealProductDto). Owner, 2026-10-15.
  @ApiProperty({ example: 45, description: 'The line\'s client price; may be below zero (a credit line).' })
  @IsNumber()
  priceClient!: number;

  @ApiProperty({ example: 15 })
  @IsNumber()
  @Min(0)
  costCompany!: number;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @Min(0)
  costForTech!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;

  @ApiPropertyOptional({
    example: 'user-uuid',
    description: 'Workiz "Sold by": a user id. Absent keeps the line\'s; "" clears it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  soldBy?: string;

  @ApiPropertyOptional({
    example: { 'In Store Location': 'B4' },
    description: "The line's custom field values by field name (the item catalog's). Absent keeps the line's.",
  })
  @IsOptional()
  @IsObject()
  customAttributes?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Workiz "Optional Item": out of the Total and of Sync to job until the client picks it. Absent keeps the line\'s.',
  })
  @IsOptional()
  @IsBoolean()
  optional?: boolean;
}

export class ItemTaxableDto {
  @ApiProperty()
  @IsBoolean()
  taxable!: boolean;
}

export class ReorderItemsDto {
  @ApiProperty({ type: [String], description: 'Every line id of the estimate, in the new order.' })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  lineIds!: string[];
}
