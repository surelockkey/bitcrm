import {
  IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentDiscountDto } from './document-discount.dto';

export class ReplaceAllDealProductItemDto {
  @ApiProperty({ example: 'product-uuid' })
  @IsString()
  productId!: string;

  @ApiPropertyOptional({ enum: ['product', 'service'], description: 'Looked up in inventory when absent.' })
  @IsOptional()
  @IsIn(['product', 'service'])
  productType?: 'product' | 'service';

  @ApiProperty({ example: 'Kwikset Deadbolt' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'KW-DB-001' })
  @IsString()
  sku!: string;

  @ApiPropertyOptional({ example: 'Front door' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 45 })
  @IsNumber()
  priceClient!: number;

  @ApiProperty({ example: 15 })
  @IsNumber()
  costCompany!: number;

  @ApiProperty({ example: 20 })
  @IsNumber()
  costForTech!: number;

  @ApiPropertyOptional({ example: true, description: 'Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;
}

export class ReplaceAllDealProductsDto {
  @ApiProperty({ example: 'user-uuid' })
  @IsString()
  actorId!: string;

  @ApiPropertyOptional({ example: 'jane@acme.com' })
  @IsOptional()
  @IsString()
  actorName?: string;

  @ApiProperty({ example: 'AB12CD-1' })
  @IsString()
  estimateNumber!: string;

  @ApiProperty({ type: [ReplaceAllDealProductItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplaceAllDealProductItemDto)
  items!: ReplaceAllDealProductItemDto[];

  @ApiPropertyOptional({
    type: String, nullable: true,
    description: 'Absent: keep the job tax. null: manual no-tax. id: manual snapshot of that rate.',
  })
  @IsOptional()
  @IsString()
  taxRateId?: string | null;

  @ApiPropertyOptional({
    example: 'CT Sales Tax',
    description: "The estimate's snapshot name — used only when `taxRateId` no longer resolves to a service-area tax.",
  })
  @IsOptional()
  @IsString()
  taxRateName?: string;

  @ApiPropertyOptional({
    example: 6.35,
    description: "The estimate's snapshot percent — used only when `taxRateId` no longer resolves.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRatePercent?: number;

  @ApiPropertyOptional({ type: DocumentDiscountDto, nullable: true, description: 'Absent: keep. null: remove.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentDiscountDto)
  discount?: DocumentDiscountDto | null;
}
