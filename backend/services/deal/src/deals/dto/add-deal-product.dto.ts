import { IsString, IsNumber, Min, IsOptional, IsIn, IsBoolean, MaxLength } from 'class-validator';
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
  // `imported` is deliberately not accepted: it marks a historical Workiz line
  // that never moved BitCRM stock, and only the importer writes it. Editing
  // such a line through the API turns it into a normal line.
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

  // The line's costs are the price book's, read by the server from inventory
  // (`costCompany` / `costTech`). Inventory leaves `costCompany` out of every
  // catalog answer for a caller without `financials.view` — a technician, a
  // dispatcher — so requiring it here made adding an item impossible for them.
  // No client ever sent anything but the catalog's own numbers, so the fields
  // are accepted for old clients and ignored.
  @ApiPropertyOptional({
    example: 15.0,
    deprecated: true,
    description: "Ignored — the server copies the price book's `costCompany`.",
  })
  @IsOptional()
  @IsNumber()
  costCompany?: number;

  @ApiPropertyOptional({
    example: 20.0,
    deprecated: true,
    description: "Ignored — the server copies the price book's `costTech`.",
  })
  @IsOptional()
  @IsNumber()
  costForTech?: number;

  @ApiProperty({ example: 45.0 })
  @IsNumber()
  priceClient!: number;

  @ApiPropertyOptional({
    example: true,
    description:
      "Whether the job's tax applies to this line. Defaults to the catalog product's " +
      'flag (itself defaulting to true); an edit keeps the line\'s current value.',
  })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;

  @ApiPropertyOptional({ example: 'Front door, keyed alike', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
