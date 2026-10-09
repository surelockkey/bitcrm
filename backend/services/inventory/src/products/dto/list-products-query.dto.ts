import { IsOptional, IsString, IsEnum, IsIn, IsInt, IsBoolean, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType, InventoryStatus } from '@bitcrm/types';
import { PRODUCT_STOCK_LEVELS, type ProductStockLevel } from '../products.constants';

export class ListProductsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: ProductType })
  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: InventoryStatus })
  @IsOptional()
  @IsEnum(InventoryStatus)
  status?: InventoryStatus;

  @ApiPropertyOptional({ description: 'Brand catalog id.' })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      '`true` — stock-managed products only (product-type rows whose flag is absent or true); ' +
      '`false` — rows that explicitly say `manageStock: false`.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === '1' || value === true) return true;
    if (value === 'false' || value === '0' || value === false) return false;
    return value;
  })
  @IsBoolean()
  manageStock?: boolean;

  @ApiPropertyOptional({
    enum: PRODUCT_STOCK_LEVELS,
    description:
      "Workiz's stock levels: `stocked` — more on hand than the re-order point (`reorderLevel`, none = 0); " +
      '`low` — at or under it (nothing on hand counts as low).',
  })
  @IsOptional()
  @IsIn(PRODUCT_STOCK_LEVELS)
  stockLevel?: ProductStockLevel;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
