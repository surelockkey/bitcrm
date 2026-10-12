import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCustomAttributes } from '../../products/dto/custom-attributes.validator';

/**
 * One line of the group as Workiz's popup edits it: the item, its Price,
 * Cost and Quantity. The line's name, description, taxable flag and custom
 * field values default to what the group already had for that item, else to
 * the price book's.
 */
export class ItemGroupMemberDto {
  @ApiProperty({ example: 'product-uuid', description: 'A price-book item (`Product.id`).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  productId!: string;

  @ApiPropertyOptional({ example: 'Service Call Fee', description: "The line's name; the item's when absent." })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  @ApiProperty({ example: 1.5, description: 'Workiz takes fractions (1.5 hours).' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(1_000_000)
  quantity!: number;

  @ApiProperty({ example: 45, description: 'The client price of ONE unit, the group\'s own.' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100_000_000)
  priceClient!: number;

  @ApiPropertyOptional({
    example: 0,
    description:
      "The group's cost of ONE unit (Workiz \"Cost\"). Read only from a caller with `financials.view`; " +
      'absent, the line keeps the cost it had, else the price book\'s company cost.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100_000_000)
  cost?: number;

  @ApiPropertyOptional({ description: "Absent: the line's own, else the item's." })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;

  @ApiPropertyOptional({ maxLength: 2000, description: "The line's long description (Workiz `desc_long`)." })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Custom field NAME → text, as on the item; blank values are dropped.' })
  @IsOptional()
  @IsCustomAttributes()
  customAttributes?: Record<string, string | null>;
}
