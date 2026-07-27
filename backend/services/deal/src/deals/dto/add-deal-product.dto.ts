import { IsString, IsNumber, Min, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { type DealProductFulfillment } from '@bitcrm/types';

export class AddDealProductDto {
  @ApiPropertyOptional({
    enum: ['sourced', 'to_order', 'service'],
    default: 'sourced',
    description:
      'How this line is fulfilled. `sourced` (default) deducts from the source ' +
      "technician's container; `to_order` records a part the tech doesn't carry " +
      '(no deduction); `service` adds a non-stockable service line (no deduction).',
  })
  @IsOptional()
  @IsIn(['sourced', 'to_order', 'service'])
  fulfillment?: DealProductFulfillment;

  @ApiPropertyOptional({
    example: 'tech-uuid',
    description:
      'Assigned technician whose container supplies this product. Required for ' +
      '`sourced` lines; ignored for `to_order` / `service`.',
  })
  @IsOptional()
  @IsString()
  sourceTechId?: string;

  @ApiProperty({ example: 'product-uuid' })
  @IsString()
  productId!: string;

  @ApiProperty({ example: 'Kwikset Deadbolt' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'KW-DB-001' })
  @IsString()
  sku!: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 15.0 })
  @IsNumber()
  costCompany!: number;

  @ApiProperty({ example: 20.0 })
  @IsNumber()
  costForTech!: number;

  @ApiProperty({ example: 45.0 })
  @IsNumber()
  priceClient!: number;
}
