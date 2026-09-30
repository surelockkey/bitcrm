import {
  IsString,
  IsEnum,
  IsInt,
  IsNumber,
  IsBoolean,
  IsOptional,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType } from '@bitcrm/types';
import { IsCustomAttributes } from './custom-attributes.validator';

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

  @ApiPropertyOptional({
    default: true,
    description: 'Default `taxable` flag copied onto job/estimate lines. Defaults to true.',
  })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiPropertyOptional({ description: 'Brand catalog id.' })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiProperty({ default: false })
  @IsBoolean()
  serialTracking!: boolean;

  @ApiProperty({ default: 0 })
  @IsNumber()
  @Min(0)
  minimumStockLevel!: number;

  // `number` and `onHand` are deliberately not declared: the ValidationPipe
  // whitelist strips them, so a client can neither pick a product number nor
  // set a stock total.

  @ApiPropertyOptional({
    default: true,
    description: 'Whether stock is counted for this product. Absent ⇒ true; services never are.',
  })
  @IsOptional()
  @IsBoolean()
  manageStock?: boolean;

  @ApiPropertyOptional({ description: 'Reorder point.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  reorderLevel?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'In Store Location': 'Aisle 4' },
    description:
      'Custom field values keyed by the field NAME (GET /item-attributes). Only names in the ' +
      'catalog are accepted (400 otherwise); an empty value is not stored.',
  })
  @IsOptional()
  @IsCustomAttributes()
  customAttributes?: Record<string, string | null>;

  @ApiPropertyOptional({ description: 'Workiz "Add to booking items". Absent ⇒ false.' })
  @IsOptional()
  @IsBoolean()
  availableInBooking?: boolean;

  @ApiPropertyOptional({ description: 'Workiz "Booking Price".' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bookingPrice?: number;

  @ApiPropertyOptional({ description: 'Workiz "Show item on price book". Absent ⇒ true.' })
  @IsOptional()
  @IsBoolean()
  priceBookEnabled?: boolean;
}
