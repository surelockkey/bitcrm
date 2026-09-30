import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNumber, IsString, Min, ValidateIf } from 'class-validator';
import { ProductType } from '@bitcrm/types';
import { CreateProductDto } from './create-product.dto';
import { IsCustomAttributes } from './custom-attributes.validator';

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
 * `description`, `taxable`, `manageStock`, `availableInBooking`,
 * `bookingPrice`, `priceBookEnabled`) sent as `null` is cleared — the
 * repository REMOVEs the attribute. A required field refuses `null`.
 *
 * `customAttributes` is a patch, not a replacement: each name sent is set (or
 * cleared by `null` / `""`), every other value the item has is kept. The map
 * itself refuses `null`, so one request can never wipe all of them.
 */
/** Redeclared below with `whenSent`: `null` must fail them, not skip them. */
const REDECLARED_FIELDS = [...REQUIRED_FIELDS, 'customAttributes'] as const;

export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, REDECLARED_FIELDS)) {
  @ApiPropertyOptional()
  @whenSent
  @IsString()
  name?: string;

  /**
   * A different SKU moves the product to it (the SKU claim goes with it); a
   * SKU another product holds is a 409. The same SKU is no change.
   */
  @ApiPropertyOptional({ description: 'Workiz SKU / Model #. Unique; a taken one is a 409.' })
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

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
    example: { 'In Store Location': 'Aisle 4', Link_UHS: null },
    description:
      'Custom field values to set, keyed by the field NAME; `null` or "" clears that one. ' +
      'Values not named are kept. Only names in the catalog are accepted (400 otherwise).',
  })
  @whenSent
  @IsCustomAttributes()
  customAttributes?: Record<string, string | null>;
}
