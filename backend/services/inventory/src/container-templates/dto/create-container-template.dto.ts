import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** Most lines one template may hold — the diff reads two stock rows per line. */
export const MAX_TEMPLATE_ITEMS = 500;

export class ContainerTemplateItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productId!: string;

  /** Target quantity. `productName` / `sku` come from the catalog, never the client. */
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateContainerTemplateDto {
  @ApiProperty({ example: 'Standard van', description: 'Unique among active templates, case-insensitive.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    type: [ContainerTemplateItemDto],
    description:
      'At least one line, each product once; every product must exist and be stock-managed ' +
      '(type `product`, `manageStock` not false).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_TEMPLATE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ContainerTemplateItemDto)
  items!: ContainerTemplateItemDto[];
}
