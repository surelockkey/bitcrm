import { IsString, IsNumber, Min, IsOptional, IsIn, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { type DealProductFulfillment } from '@bitcrm/types';
import { IsCustomAttributes } from './custom-attributes.validator';

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

  // Workiz "Add job item" has a Cost box: the line's own cost, prefilled from
  // the price book. Inventory leaves `costCompany` out of every catalog answer
  // for a caller without `financials.view` — a technician, a dispatcher — so
  // only a caller with it may set the cost; from anyone else it is ignored.
  @ApiPropertyOptional({
    example: 15.0,
    description:
      "The line's cost to the company (Workiz \"Cost\"). Honoured for a caller with `financials.view`; " +
      "otherwise, and when absent, the price book's `costCompany` on add or a swap, and the line's own " +
      'on an in-place edit (Workiz freezes the cost on the line). Σ quantity × cost over the lines is the ' +
      "job's Company Cost and the commissions report's Company Parts.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costCompany?: number;

  @ApiPropertyOptional({
    example: 20.0,
    deprecated: true,
    description: "Ignored — the server copies the price book's `costTech`.",
  })
  @IsOptional()
  @IsNumber()
  costForTech?: number;

  @ApiProperty({
    example: 45.0,
    description:
      'The line\'s client price — any number, below zero too (a credit line, Workiz "Approved Discount"). ' +
      'A technician and the office alike set any price (owner, 2026-10-15); it applies to this line only ' +
      'and never changes the price book.',
  })
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

  @ApiPropertyOptional({
    example: 'user-uuid',
    description:
      'Workiz "Sold by": the user credited with this line. Absent on add → nobody; absent on an edit → ' +
      'the line keeps its own; `""` clears it.',
  })
  @IsOptional()
  @IsString()
  soldBy?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
    example: { 'In Store Location': 'Aisle 4', Link_UHS: 'https://…' },
    description:
      "The line's custom field values (Workiz \"Edit item\" on a job line), keyed by the field " +
      'NAME as `GET /inventory/item-attributes` lists them. Absent on add → copied from the ' +
      "product; absent on an edit → the line keeps its own (a swap starts from the new product's). " +
      'Sent, it is the complete set: `null` or `""` leaves a field empty. Never changes the product.',
  })
  @IsOptional()
  @IsCustomAttributes()
  customAttributes?: Record<string, string | null>;
}
