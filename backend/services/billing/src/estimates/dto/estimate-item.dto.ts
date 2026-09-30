import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
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

  @ApiProperty({ example: 45 })
  @IsNumber()
  @Min(0)
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
