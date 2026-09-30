import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNumber, IsString, Min, ValidateIf } from 'class-validator';
import { ProductType } from '@bitcrm/types';
import { CreateProductDto } from './create-product.dto';

/**
 * Validate a field only when the body carries it — and `null` counts as
 * carried, so a required field sent as `null` fails its type check instead
 * of being skipped the way `@IsOptional()` would skip it.
 */
const whenSent = ValidateIf((_: unknown, value: unknown) => value !== undefined);

/** The fields every product has: an update may leave them out but never clear them. */
const REQUIRED_FIELDS = [
  'name',
  'sku',
  'category',
  'type',
  'costCompany',
  'costTech',
  'priceClient',
  'serialTracking',
  'minimumStockLevel',
] as const;

/**
 * Partial: only the fields a request carries are validated and written.
 * An optional field (`brandId`, `reorderLevel`, `supplier`, `barcode`,
 * `description`, `taxable`, `manageStock`) sent as `null` is cleared — the
 * repository REMOVEs the attribute. A required field refuses `null`.
 */
export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, REQUIRED_FIELDS)) {
  @ApiPropertyOptional()
  @whenSent
  @IsString()
  name?: string;

  /** Immutable after create — accepted for back-compat and ignored by the repository. */
  @ApiPropertyOptional()
  @whenSent
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ example: 'Locks > Residential > Deadbolts' })
  @whenSent
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: ProductType })
  @whenSent
  @IsEnum(ProductType)
  type?: ProductType;

  @ApiPropertyOptional()
  @whenSent
  @IsNumber()
  @Min(0)
  costCompany?: number;

  @ApiPropertyOptional()
  @whenSent
  @IsNumber()
  @Min(0)
  costTech?: number;

  @ApiPropertyOptional()
  @whenSent
  @IsNumber()
  @Min(0)
  priceClient?: number;

  @ApiPropertyOptional()
  @whenSent
  @IsBoolean()
  serialTracking?: boolean;

  @ApiPropertyOptional()
  @whenSent
  @IsNumber()
  @Min(0)
  minimumStockLevel?: number;
}
